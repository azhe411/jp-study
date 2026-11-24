/**
 * clientOpId 幂等层 —— 挂在受保护作用域内，对 POST/PUT/PATCH/DELETE 生效。
 *
 * preHandler：占位（INSERT … ON CONFLICT DO NOTHING）。
 *   · 同键同体且已完成 → 原样重放，并标记 Idempotent-Replayed: true
 *   · 同键异体          → 422 IDEMPOTENCY_KEY_REUSED
 *   · 同键仍在处理      → 稍候片刻再看；久等不来则 422，请客户端稍后重试
 * onSend：记录最终响应；5xx 则释放该键，允许以同一 clientOpId 重试。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY } from '../../../shared/constants';
import { AppError } from '../lib/errors';
import { sha256, stableStringify } from '../lib/util';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WAIT_STEPS = 20;
const WAIT_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractClientOpId(req: FastifyRequest): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  const query = req.query as Record<string, unknown> | undefined;
  const v = body?.clientOpId ?? query?.clientOpId;
  return typeof v === 'string' ? v : undefined;
}

function requestHash(req: FastifyRequest): string {
  const path = req.url.split('?')[0];
  const query = { ...((req.query as Record<string, unknown>) ?? {}) };
  delete query.clientOpId;
  return sha256(stableStringify({ m: req.method, path, query, body: req.body ?? null }));
}

export function registerIdempotency(app: FastifyInstance): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!WRITE_METHODS.has(req.method) || req.routeOptions.config?.idempotent === false) return;
    const clientOpId = extractClientOpId(req);
    if (!clientOpId) {
      throw new AppError('VALIDATION_FAILED', '写操作缺少 clientOpId', [{ path: '/clientOpId', message: '必填' }]);
    }
    const hash = requestHash(req);
    const userId = req.userId;

    const inserted = await app.db.query(
      `INSERT INTO idempotency_keys (user_id, client_op_id, request_hash) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, clientOpId, hash],
    );
    if (inserted.rowCount) {
      req.idem = { userId, clientOpId };
      return;
    }

    for (let i = 0; i <= WAIT_STEPS; i++) {
      const { rows } = await app.db.query(
        'SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND client_op_id = $2',
        [userId, clientOpId],
      );
      const row = rows[0];
      if (!row) {
        // 上一次以 5xx 收场、键已释放：本次接手
        const again = await app.db.query(
          `INSERT INTO idempotency_keys (user_id, client_op_id, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [userId, clientOpId, hash],
        );
        if (again.rowCount) {
          req.idem = { userId, clientOpId };
          return;
        }
        continue;
      }
      if (row.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
      if (row.status_code !== null) {
        reply.header(IDEMPOTENCY.replayHeader, 'true').code(row.status_code);
        return reply.send(row.response ?? undefined);
      }
      await sleep(WAIT_MS);
    }
    throw new AppError('UNPROCESSABLE', '同一操作仍在处理中，请稍后重试');
  });

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const idem = req.idem;
    if (!idem) return payload;
    req.idem = undefined;
    if (reply.statusCode >= 500) {
      await app.db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND client_op_id = $2', [
        idem.userId,
        idem.clientOpId,
      ]);
      return payload;
    }
    let body: unknown = null;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        body = JSON.parse(payload);
      } catch {
        body = null;
      }
    }
    await app.db.query(
      'UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE user_id = $1 AND client_op_id = $2',
      [idem.userId, idem.clientOpId, reply.statusCode, body === null ? null : JSON.stringify(body)],
    );
    return payload;
  });
}

/** 清理过期幂等键；由服务进程定时调用 */
export async function purgeIdempotencyKeys(app: FastifyInstance): Promise<number> {
  const { rowCount } = await app.db.query(
    `DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(days => $1)`,
    [IDEMPOTENCY.retentionDays],
  );
  return rowCount ?? 0;
}
