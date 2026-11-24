/**
 * 按用户选 AI Key（契约 §17）：自己的 Key → 共享额度（服务器 Key）→ 403 AI_KEY_REQUIRED。
 */
import type { FastifyInstance } from 'fastify';
import type { AiKeyStatus } from '../../../shared/types';
import { AppError } from '../lib/errors';
import { open } from '../lib/secretBox';
import type { AiService } from './ai';

export async function aiKeyStatus(app: FastifyInstance, userId: string): Promise<AiKeyStatus & { sealed: string | null }> {
  const { rows } = await app.db.query(
    `SELECT u.shared_ai, k.key_sealed, k.last4, k.updated_at
       FROM users u LEFT JOIN user_ai_keys k ON k.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0] ?? {};
  const own = !!r.key_sealed;
  const shared = !!r.shared_ai && app.ai.configured;
  return {
    source: own ? 'own' : shared ? 'shared' : 'none',
    hasOwnKey: own,
    last4: (r.last4 as string | null) ?? null,
    provider: 'deepseek',
    updatedAt: r.updated_at ? (r.updated_at as Date).toISOString() : null,
    sealed: (r.key_sealed as string | null) ?? null,
  };
}

/** 这个用户发起的 AI 调用该用哪把 Key */
export async function userAi(app: FastifyInstance, userId: string): Promise<AiService> {
  const s = await aiKeyStatus(app, userId);
  if (s.source === 'own') return app.ai.withKey(open(s.sealed!, app.config.aiKeySecret));
  if (s.source === 'shared') return app.ai;
  throw new AppError('AI_KEY_REQUIRED');
}
