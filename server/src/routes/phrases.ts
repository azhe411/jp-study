/**
 * 句库（旅行 / 生活）与逐句跟读。
 * 内置句只能改备注和收藏，不能改内容、不能删；自建句随意。
 * 跟读只更新句子的最高分与练习次数，不涨 version —— 那是"练习进度"，不是"内容修改"。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { PHRASE_BOOKS, RECOGNITION_METHODS, type RecognitionMethod } from '../../../shared/constants';
import type { Phrase, PhraseAttempt } from '../../../shared/types';
import { getOwned, softDelete, updateVersioned, withTx } from '../db/pool';
import { AppError } from '../lib/errors';
import { attemptTime, camelRow, clampLimit, decodeCursor, paginate, uuid } from '../lib/util';
import { DeleteQuery, IdParams, IsoDateTime, Lit, Nullable, PageQuery, Uuid, VersionedMeta, WriteMeta, partial } from '../schemas';
import { scoreSpeech } from '../services/scoring';
import { ensurePhraseSeed } from '../services/seed';
import { getExistingOrReject, pickSets } from './tasks';

type Row = Record<string, unknown>;

export const phraseToApi = (row: Row) => camelRow<Phrase>(row, ['slug', 'sort_key']);
export const phraseAttemptToApi = (row: Row) => camelRow<PhraseAttempt>(row, ['version', 'updated_at', 'deleted_at']);

const PhraseFields = {
  category: Type.String({ minLength: 1, maxLength: 40 }),
  ja: Type.String({ minLength: 1, maxLength: 300 }),
  reading: Type.String({ minLength: 1, maxLength: 600 }),
  zh: Type.String({ minLength: 1, maxLength: 300 }),
  note: Nullable(Type.String({ maxLength: 1000 })),
};

/** 跟读请求体（句库跟读与朗读/影子跟读共用的部分） */
export const AttemptFields = {
  id: Type.Optional(Uuid),
  method: Lit(RECOGNITION_METHODS),
  selfScore: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  attemptedAt: Type.Optional(IsoDateTime),
};

export function requireSelfScore(method: string, selfScore: number | undefined) {
  if (method === 'selfAssessed' && selfScore === undefined) {
    throw new AppError('VALIDATION_FAILED', '自评模式需要填写自评分', [{ path: '/selfScore', message: 'method=selfAssessed 时必填' }]);
  }
}

export const phraseRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/phrases',
    {
      schema: {
        querystring: Type.Object({
          book: Type.Optional(Lit(PHRASE_BOOKS)),
          category: Type.Optional(Type.String({ maxLength: 40 })),
          favorite: Type.Optional(Type.Boolean()),
          q: Type.Optional(Type.String({ maxLength: 100 })),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      await ensurePhraseSeed(app.db, req.userId);
      const { book, category, favorite, q, cursor, limit } = req.query;
      const lim = clampLimit(limit);
      const c = decodeCursor(cursor);
      const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
      const { rows } = await app.db.query(
        `SELECT * FROM phrases
          WHERE user_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR book = $2)
            AND ($3::text IS NULL OR category = $3)
            AND ($4::boolean IS NULL OR favorite = $4)
            AND ($5::text IS NULL OR ja ILIKE $5 OR reading ILIKE $5 OR zh ILIKE $5)
            AND ($6::bigint IS NULL OR (sort_key, id) > ($6::bigint, $7::uuid))
          ORDER BY sort_key, id LIMIT $8`,
        [req.userId, book ?? null, category ?? null, favorite ?? null, like, c ? c.k[0] : null, c?.id ?? null, lim + 1],
      );
      const page = paginate(rows, lim, (r) => ({ k: [r.sort_key], id: r.id as string }));
      return { items: page.items.map(phraseToApi), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/phrases',
    {
      schema: {
        body: Type.Object({ ...WriteMeta, id: Type.Optional(Uuid), book: Lit(PHRASE_BOOKS), ...PhraseFields, note: Type.Optional(PhraseFields.note) }, {
          additionalProperties: false,
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const id = b.id ?? uuid();
      const { rows } = await app.db.query(
        `INSERT INTO phrases (id, user_id, book, category, ja, reading, zh, note, sort_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id, req.userId, b.book, b.category.trim(), b.ja.trim(), b.reading.trim(), b.zh.trim(), b.note ?? null, Date.now()],
      );
      return reply.code(201).send(phraseToApi(rows[0] ?? (await getExistingOrReject(app.db, 'phrases', req.userId, id))));
    },
  );

  app.get('/phrases/:id', { schema: { params: IdParams } }, async (req) =>
    phraseToApi(await getOwned(app.db, 'phrases', req.userId, req.params.id)),
  );

  app.patch(
    '/phrases/:id',
    {
      schema: {
        params: IdParams,
        body: Type.Object({ ...VersionedMeta, ...partial(PhraseFields), favorite: Type.Optional(Type.Boolean()) }, {
          additionalProperties: false,
          minProperties: 2,
        }),
      },
    },
    async (req) => {
      const content = (['category', 'ja', 'reading', 'zh'] as const).some((k) => req.body[k] !== undefined);
      if (content) {
        const row = await getOwned(app.db, 'phrases', req.userId, req.params.id);
        if (row.builtin) throw new AppError('FORBIDDEN', '内置句只能修改备注和收藏');
      }
      const sets = pickSets(req.body, ['category', 'ja', 'reading', 'zh', 'note', 'favorite']);
      return phraseToApi(await updateVersioned(app.db, 'phrases', req.userId, req.params.id, req.body.baseVersion, sets, phraseToApi));
    },
  );

  app.delete('/phrases/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    const { rows } = await app.db.query('SELECT builtin FROM phrases WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (rows[0]?.builtin) throw new AppError('FORBIDDEN', '内置句不能删除，可以取消收藏');
    await softDelete(app.db, 'phrases', req.userId, req.params.id, req.query.baseVersion, phraseToApi);
    return reply.code(204).send();
  });

  /* ───────────── 跟读 ───────────── */

  app.get('/phrases/:id/attempts', { schema: { params: IdParams, querystring: Type.Object(PageQuery) } }, async (req) => {
    await getOwned(app.db, 'phrases', req.userId, req.params.id);
    const lim = clampLimit(req.query.limit);
    const c = decodeCursor(req.query.cursor);
    const { rows } = await app.db.query(
      `SELECT * FROM phrase_attempts
        WHERE phrase_id = $1 AND user_id = $2 AND deleted_at IS NULL
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $5`,
      [req.params.id, req.userId, c ? c.k[0] : null, c?.id ?? null, lim + 1],
    );
    const page = paginate(rows, lim, (r) => ({ k: [(r.created_at as Date).toISOString()], id: r.id as string }));
    return { items: page.items.map(phraseAttemptToApi), nextCursor: page.nextCursor };
  });

  app.post(
    '/phrases/:id/attempts',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            ...WriteMeta,
            ...AttemptFields,
            transcript: Type.String({ maxLength: 1000 }),
            durationMs: Type.Integer({ minimum: 0, maximum: 600_000 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      requireSelfScore(b.method, b.selfScore);
      const at = attemptTime(b.attemptedAt);
      const id = b.id ?? uuid();

      return withTx(app.db, async (tx) => {
        const { rows } = await tx.query('SELECT * FROM phrases WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [
          req.params.id,
          req.userId,
        ]);
        const phrase = rows[0];
        if (!phrase) throw new AppError('NOT_FOUND');

        // 同一次跟读（离线重推）：原样返回，不重复计数
        const dup = await tx.query('SELECT * FROM phrase_attempts WHERE id = $1', [id]);
        if (dup.rows[0]) {
          if (dup.rows[0].user_id !== req.userId || dup.rows[0].phrase_id !== phrase.id) throw new AppError('UNPROCESSABLE', 'id 已被占用');
          return reply.code(201).send(phraseAttemptToApi(dup.rows[0]));
        }

        const { scores, diff } = scoreSpeech({
          reference: phrase.ja as string,
          referenceReading: phrase.reading as string,
          transcript: b.transcript,
          method: b.method as RecognitionMethod,
          durationMs: b.durationMs,
          selfScore: b.selfScore,
        });
        const ins = await tx.query(
          `INSERT INTO phrase_attempts (id, user_id, phrase_id, transcript, method, duration_ms, scores, diff, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [id, req.userId, phrase.id, b.transcript, b.method, b.durationMs, JSON.stringify(scores), JSON.stringify(diff), at],
        );
        await tx.query(
          `UPDATE phrases SET best_score = GREATEST(COALESCE(best_score, 0), $2), attempt_count = attempt_count + 1 WHERE id = $1`,
          [phrase.id, scores.overall],
        );
        return reply.code(201).send(phraseAttemptToApi(ins.rows[0]));
      });
    },
  );
};
