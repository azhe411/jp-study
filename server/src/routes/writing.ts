/**
 * 写作 / 日记：草稿可离线（经 sync 推送），提交批改必须在线。
 * 提交时先把条目落成 submitted，再请 AI；AI 失败则标记 failed 并返回 503，可用同 id 重新提交。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { WRITING_KINDS, WRITING_MAX_CHARS, WRITING_STATUSES, type WritingKind } from '../../../shared/constants';
import type { WritingEntry } from '../../../shared/types';
import { getOwned, softDelete } from '../db/pool';
import { pageByCreated } from '../db/records';
import { AppError } from '../lib/errors';
import { camelRow, uuid } from '../lib/util';
import { DeleteQuery, IdParams, Lit, Nullable, PageQuery, Uuid, WriteMeta } from '../schemas';
import { userAi } from '../services/aiKeys';
import { aiWritingCorrection } from '../services/aiTasks';

type Row = Record<string, unknown>;

export const writingToApi = (row: Row) => camelRow<WritingEntry>(row);

/** 字数：不计空白 */
export const charCountOf = (s: string) => Array.from(s.replace(/\s/g, '')).length;

export const WritingFields = {
  kind: Lit(WRITING_KINDS),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  prompt: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
  content: Type.String({ minLength: 1, maxLength: WRITING_MAX_CHARS }),
};

export const writingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/writing/submit',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: Type.Object({ ...WriteMeta, id: Type.Optional(Uuid), ...WritingFields }, { additionalProperties: false }) },
    },
    async (req) => {
      const b = req.body;
      const id = b.id ?? uuid();
      const content = b.content.trim();
      if (!content) throw new AppError('VALIDATION_FAILED', '正文不能为空', [{ path: '/content', message: '不能为空' }]);

      const existing = await app.db.query('SELECT * FROM writing_entries WHERE id = $1', [id]);
      const prev = existing.rows[0];
      if (prev && (prev.user_id !== req.userId || prev.deleted_at)) throw new AppError('UNPROCESSABLE', 'id 已被占用');
      if (prev?.status === 'corrected') throw new AppError('UNPROCESSABLE', '这篇已经批改过了，想再改请另存一篇');

      const { rows } = await app.db.query(
        `INSERT INTO writing_entries (id, user_id, kind, title, prompt, content, status, char_count, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7, now())
         ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, prompt = EXCLUDED.prompt, content = EXCLUDED.content,
                                        status = 'submitted', char_count = EXCLUDED.char_count, submitted_at = now(), version = writing_entries.version + 1
         RETURNING *`,
        [id, req.userId, b.kind, b.title.trim(), b.prompt ?? null, content, charCountOf(content)],
      );
      const entry = rows[0];

      try {
        const correction = await aiWritingCorrection(await userAi(app, req.userId), { kind: b.kind as WritingKind, title: entry.title, prompt: entry.prompt, content });
        const done = await app.db.query(
          `UPDATE writing_entries SET status = 'corrected', correction = $2, version = version + 1 WHERE id = $1 RETURNING *`,
          [id, JSON.stringify(correction)],
        );
        return writingToApi(done.rows[0]);
      } catch (e) {
        // 正文已经保存好了：标记失败，下次换个 clientOpId 用同一 id 重交即可
        await app.db.query(`UPDATE writing_entries SET status = 'failed', version = version + 1 WHERE id = $1`, [id]);
        throw e;
      }
    },
  );

  app.get(
    '/writing/entries',
    { schema: { querystring: Type.Object({ kind: Type.Optional(Lit(WRITING_KINDS)), status: Type.Optional(Lit(WRITING_STATUSES)), ...PageQuery }) } },
    async (req) => pageByCreated(app.db, 'writing_entries', req.userId, { kind: req.query.kind, status: req.query.status }, req.query, writingToApi),
  );

  app.get('/writing/entries/:id', { schema: { params: IdParams } }, async (req) =>
    writingToApi(await getOwned(app.db, 'writing_entries', req.userId, req.params.id)),
  );

  app.delete('/writing/entries/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'writing_entries', req.userId, req.params.id, req.query.baseVersion, writingToApi);
    return reply.code(204).send();
  });
};
