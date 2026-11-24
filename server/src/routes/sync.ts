/**
 * 同步协议（契约 §8）。
 *
 * push：每条 op 转成对应的 REST 请求，在进程内 inject 执行 ——
 *   校验、乐观锁、幂等（clientOpId）、服务端补全（评分等）与直接调 REST 完全一致，不另写一套。
 *   结果映射：2xx → applied（重放命中则 duplicate）；409 → conflict；其余 → rejected。
 * pull：各表按 rev 取增量，归并后按 rev 升序截断；游标即最后一条的 rev。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  API_PREFIX,
  APPEND_ONLY_ENTITIES,
  IDEMPOTENCY,
  PUSHABLE_ENTITIES,
  SYNC_LIMITS,
  SYNC_OP_ACTIONS,
  type ErrorCode,
  type PushableEntity,
} from '../../../shared/constants';
import type { SyncChange, SyncOp, SyncOpResult, SyncPullResponse, SyncPushResponse } from '../../../shared/types';
import { updateVersioned, type Queryable } from '../db/pool';
import { AppError } from '../lib/errors';
import { decodeCursor, encodeCursor } from '../lib/util';
import { IsoDateTime, Lit, Uuid } from '../schemas';
import { ENTITIES } from '../services/entities';
import { ensurePhraseSeed } from '../services/seed';
import { loadSettingsRow } from '../services/settings';
import { charCountOf, writingToApi } from './writing';

type Inject = { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: Record<string, unknown> };
type Outcome = { status: number; body: unknown; replayed?: boolean };

/** 普通增改删实体的 REST 前缀 */
const CRUD: Partial<Record<PushableEntity, string>> = {
  task: '/tasks',
  taskTemplate: '/task-templates',
  card: '/cards',
  mistake: '/mistakes',
  phrase: '/phrases',
  course: '/courses',
};

/** 只追加实体的创建入口 */
const CREATE_ONLY: Partial<Record<PushableEntity, (data: Record<string, unknown>) => { url: string; body: Record<string, unknown> }>> = {
  reviewLog: ({ cardId, ...rest }) => ({ url: `/cards/${cardId}/review`, body: rest }),
  phraseAttempt: ({ phraseId, ...rest }) => ({ url: `/phrases/${phraseId}/attempts`, body: rest }),
  speakingAttempt: (d) => ({ url: '/speaking/attempts', body: d }),
  listeningAttempt: (d) => ({ url: '/listening/attempts', body: d }),
  readingAttempt: (d) => ({ url: '/reading/attempts', body: d }),
  pronunciationAttempt: (d) => ({ url: '/pronunciation/attempts', body: d }),
  expressionAttempt: (d) => ({ url: '/expressions/attempts', body: d }),
  kanjiAttempt: (d) => ({ url: '/kanji/attempts', body: d }),
  timeLog: (d) => ({ url: '/stats/time-logs', body: d }),
};

const rejected = (op: SyncOp, code: ErrorCode, message: string): SyncOpResult => ({
  clientOpId: op.clientOpId, entity: op.entity, id: op.id, status: 'rejected', error: { code, message },
});

export const syncRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /** 草稿只在这里写：REST 只有"提交批改"，离线存草稿走 sync（契约 §8.6） */
  async function writingDraft(q: Queryable, userId: string, op: SyncOp): Promise<Outcome> {
    const d = (op.data ?? {}) as Record<string, string | null | undefined>;
    if (d.status !== undefined && d.status !== 'draft') {
      return { status: 422, body: { error: { code: 'UNPROCESSABLE', message: '离线只能保存草稿，提交批改需要联网' } } };
    }
    const cols: Record<string, unknown> = {};
    for (const k of ['kind', 'title', 'prompt', 'content'] as const) if (d[k] !== undefined) cols[k] = d[k];
    if (typeof cols.content === 'string') cols.char_count = charCountOf(cols.content);
    if (op.action === 'create') {
      if (!d.kind || !d.title || d.content === undefined) {
        return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: '草稿需要 kind、title、content' } } };
      }
      const { rows } = await q.query(
        `INSERT INTO writing_entries (id, user_id, kind, title, prompt, content, char_count) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [op.id, userId, d.kind, d.title, d.prompt ?? null, d.content, charCountOf(d.content ?? '')],
      );
      if (rows[0]) return { status: 201, body: writingToApi(rows[0]) };
      // 同一草稿重推：同一用户的原样返回
      const dup = await q.query('SELECT * FROM writing_entries WHERE id = $1', [op.id]);
      if (dup.rows[0]?.user_id === userId) return { status: 200, body: writingToApi(dup.rows[0]), replayed: true };
      return { status: 422, body: { error: { code: 'UNPROCESSABLE', message: 'id 已被占用' } } };
    }
    const { rows } = await q.query('SELECT status FROM writing_entries WHERE id = $1 AND user_id = $2', [op.id, userId]);
    if (rows[0] && !['draft', 'failed'].includes(rows[0].status)) {
      return { status: 422, body: { error: { code: 'UNPROCESSABLE', message: '已提交的作文不能再改' } } };
    }
    try {
      return { status: 200, body: writingToApi(await updateVersioned(q, 'writing_entries', userId, op.id, op.baseVersion, cols, writingToApi)) };
    } catch (e) {
      if (e instanceof AppError) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
      throw e;
    }
  }

  /** 设置的 update 只带变更字段：与服务端当前值合并后整份 PUT */
  async function settingsRequest(userId: string, op: SyncOp): Promise<Inject> {
    const current = (await loadSettingsRow(app.db, userId)).data as Record<string, unknown>;
    const patch = ((op.data as { data?: Record<string, unknown> } | undefined)?.data ?? op.data ?? {}) as Record<string, unknown>;
    return { method: 'PUT', url: '/settings', payload: { clientOpId: op.clientOpId, baseVersion: op.baseVersion, data: { ...current, ...patch } } };
  }

  function restRequest(op: SyncOp): Inject | null {
    const data = { ...(op.data ?? {}) };
    delete data.clientOpId;
    delete data.baseVersion;
    const base = CRUD[op.entity];
    if (base) {
      if (op.action === 'create') return { method: 'POST', url: base, payload: { ...data, clientOpId: op.clientOpId, id: op.id } };
      if (op.action === 'update') return { method: 'PATCH', url: `${base}/${op.id}`, payload: { ...data, clientOpId: op.clientOpId, baseVersion: op.baseVersion } };
      const qs = new URLSearchParams({ clientOpId: op.clientOpId, ...(op.baseVersion ? { baseVersion: String(op.baseVersion) } : {}) });
      return { method: 'DELETE', url: `${base}/${op.id}?${qs}` };
    }
    if (op.entity === 'jlptMock') {
      if (op.action === 'create') return { method: 'POST', url: '/stats/jlpt-mocks', payload: { ...data, clientOpId: op.clientOpId, id: op.id } };
      if (op.action === 'delete') return { method: 'DELETE', url: `/stats/jlpt-mocks/${op.id}?clientOpId=${op.clientOpId}` };
      return null;
    }
    // 观看进度：create / update 都落到同一个 PUT（服务端按集合并）
    if (op.entity === 'videoProgress' && op.action !== 'delete') {
      const { courseId, page, ...rest } = data as { courseId?: string; page?: number };
      if (!courseId || !page) return null;
      return { method: 'PUT', url: `/video-progress/${encodeURIComponent(courseId)}/${page}`, payload: { ...rest, clientOpId: op.clientOpId } };
    }
    const create = CREATE_ONLY[op.entity];
    if (create && op.action === 'create') {
      const { url, body } = create(data);
      return { method: 'POST', url, payload: { ...body, clientOpId: op.clientOpId, id: op.id } };
    }
    return null;
  }

  async function runOp(userId: string, authorization: string, op: SyncOp): Promise<SyncOpResult> {
    if ((APPEND_ONLY_ENTITIES as readonly string[]).includes(op.entity) && op.action !== 'create') {
      return rejected(op, 'UNPROCESSABLE', '练习记录只能新增，不能修改或删除');
    }
    if (op.action !== 'create' && op.baseVersion === undefined && op.entity !== 'settings') {
      return rejected(op, 'VALIDATION_FAILED', 'update / delete 必须带 baseVersion');
    }

    let out: Outcome;
    if (op.entity === 'writingEntry' && op.action !== 'delete') {
      out = await writingDraft(app.db, userId, op);
    } else {
      let req: Inject | null;
      if (op.entity === 'settings') {
        if (op.action !== 'update') return rejected(op, 'UNPROCESSABLE', '设置只能 update');
        if (op.id !== userId) return rejected(op, 'VALIDATION_FAILED', '设置的 id 必须是用户 id');
        req = await settingsRequest(userId, op);
      } else if (op.entity === 'writingEntry') {
        req = { method: 'DELETE', url: `/writing/entries/${op.id}?clientOpId=${op.clientOpId}&baseVersion=${op.baseVersion}` };
      } else {
        req = restRequest(op);
      }
      if (!req) return rejected(op, 'UNPROCESSABLE', `${op.entity} 不支持 ${op.action}`);
      const res = await app.inject({
        method: req.method,
        url: `${API_PREFIX}${req.url}`,
        headers: { authorization, ...(req.payload ? { 'content-type': 'application/json' } : {}) },
        payload: req.payload ? JSON.stringify(req.payload) : undefined,
      });
      out = {
        status: res.statusCode,
        body: res.body ? JSON.parse(res.body) : null,
        replayed: res.headers[IDEMPOTENCY.replayHeader.toLowerCase()] === 'true',
      };
    }

    const base = { clientOpId: op.clientOpId, entity: op.entity, id: op.id };
    if (out.status >= 200 && out.status < 300) {
      const body = out.body as Record<string, unknown> | null;
      // 复习接口返回 { card, log }：同步关心的是复习记录本身
      const record = op.entity === 'reviewLog' && body?.log ? body.log : body;
      const version = (record as { version?: number } | null)?.version ?? 1;
      return { ...base, status: out.replayed ? 'duplicate' : 'applied', version, record };
    }
    const err = (out.body as { error?: { code: ErrorCode; message: string; details?: { serverRecord?: unknown } } } | null)?.error;
    if (out.status === 409 && err?.code === 'VERSION_CONFLICT') return { ...base, status: 'conflict', serverRecord: err.details?.serverRecord };
    return rejected(op, err?.code ?? 'INTERNAL_ERROR', err?.message ?? '处理失败');
  }

  app.post(
    '/sync/push',
    {
      // 整批没有单一的 clientOpId：幂等落在每条 op 上
      config: { idempotent: false },
      bodyLimit: 5 * 1024 * 1024,
      schema: {
        body: Type.Object(
          {
            deviceId: Type.String({ minLength: 1, maxLength: 64 }),
            ops: Type.Array(
              Type.Object(
                {
                  clientOpId: Uuid,
                  entity: Lit(PUSHABLE_ENTITIES),
                  action: Lit(SYNC_OP_ACTIONS),
                  id: Uuid,
                  baseVersion: Type.Optional(Type.Integer({ minimum: 1 })),
                  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
                  clientTimestamp: IsoDateTime,
                },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: SYNC_LIMITS.pushMaxOps },
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<SyncPushResponse> => {
      const results: SyncOpResult[] = [];
      // 按数组顺序逐条处理；后一条可能依赖前一条（先建卡再复习）
      for (const op of req.body.ops as SyncOp[]) {
        results.push(await runOp(req.userId, req.headers.authorization ?? '', op));
      }
      return { results, serverTime: new Date().toISOString() };
    },
  );

  app.get(
    '/sync/pull',
    {
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 200 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SYNC_LIMITS.pullMaxLimit })),
        }),
      },
    },
    async (req): Promise<SyncPullResponse> => {
      const limit = req.query.limit ?? SYNC_LIMITS.pullDefaultLimit;
      const since = req.query.cursor ? Number(decodeCursor(req.query.cursor)?.k[0] ?? 0) : 0;
      if (!req.query.cursor) await ensurePhraseSeed(app.db, req.userId);

      const perTable = await Promise.all(
        ENTITIES.map(async (e) => {
          const { rows } = await app.db.query(`SELECT * FROM ${e.table} WHERE user_id = $1 AND rev > $2 ORDER BY rev LIMIT $3`, [
            req.userId, since, limit + 1,
          ]);
          return rows.map(
            (r): SyncChange => ({
              entity: e.entity,
              id: r.id as string,
              rev: r.rev as number,
              version: r.version as number,
              updatedAt: (r.updated_at as Date).toISOString(),
              deletedAt: r.deleted_at ? (r.deleted_at as Date).toISOString() : null,
              data: e.toApi(r),
            }),
          );
        }),
      );
      const merged = perTable.flat().sort((a, b) => a.rev - b.rev);
      const changes = merged.slice(0, limit);
      const last = changes.at(-1)?.rev ?? since;
      return {
        changes,
        nextCursor: encodeCursor({ k: [last], id: 'rev' }),
        hasMore: merged.length > limit,
        serverTime: new Date().toISOString(),
      };
    },
  );
};
