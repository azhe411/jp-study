/**
 * 用户自带 AI Key（契约 §17）。保存前用这把 Key 真实请求一次 DeepSeek 校验；
 * 明文只在这次请求的内存里出现，入库的是密文，返回的只有末 4 位。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { AiKeyStatus } from '../../../shared/types';
import { AppError } from '../lib/errors';
import { seal } from '../lib/secretBox';
import { ClientOpId, WriteMeta } from '../schemas';
import { aiKeyStatus } from '../services/aiKeys';

export const aiKeyRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const status = async (userId: string): Promise<AiKeyStatus> => {
    const { sealed: _sealed, ...s } = await aiKeyStatus(app, userId);
    return s;
  };

  /** 用这把 Key 请求一次模型列表：200 才算可用 */
  async function verify(key: string) {
    let res: Response;
    try {
      res = await fetch(`${app.config.ai.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('AI_UNAVAILABLE', '暂时连不上 DeepSeek，没法验证这把 Key，请稍后再试');
    }
    if (res.status === 401 || res.status === 403) {
      throw new AppError('VALIDATION_FAILED', '这把 Key 无效：请检查是否复制完整，或者它已被删除', [{ path: '/apiKey', message: 'DeepSeek 拒绝了这把 Key' }]);
    }
    if (!res.ok) throw new AppError('AI_UNAVAILABLE', `DeepSeek 返回了 ${res.status}，暂时没法验证，请稍后再试`);
  }

  app.get('/me/ai-key', async (req) => status(req.userId));

  app.put(
    '/me/ai-key',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: Type.Object({ ...WriteMeta, apiKey: Type.String({ minLength: 10, maxLength: 200 }) }, { additionalProperties: false }) },
    },
    async (req) => {
      const key = req.body.apiKey.trim();
      if (!/^[\x21-\x7e]+$/.test(key)) {
        throw new AppError('VALIDATION_FAILED', 'Key 里有空格或中文字符，请重新复制', [{ path: '/apiKey', message: '包含非法字符' }]);
      }
      await verify(key);
      await app.db.query(
        `INSERT INTO user_ai_keys (user_id, key_sealed, last4) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET key_sealed = EXCLUDED.key_sealed, last4 = EXCLUDED.last4, updated_at = now()`,
        [req.userId, seal(key, app.config.aiKeySecret), key.slice(-4)],
      );
      return status(req.userId);
    },
  );

  app.delete('/me/ai-key', { schema: { querystring: Type.Object({ clientOpId: ClientOpId }) } }, async (req, reply) => {
    await app.db.query('DELETE FROM user_ai_keys WHERE user_id = $1', [req.userId]);
    return reply.code(204).send();
  });
};
