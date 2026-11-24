/**
 * 抽认卡：列表、牌组、到期、导入、单卡增改删、复习。
 * 复习只改排期、不涨 version —— 卡片"内容"的版本，与"记忆"的进度，是两回事。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { CARD_IMPORT_MAX, type ReviewRating } from '../../../shared/constants';
import type { DueCardsResponse, ImportCardsResult, RestudyGroups, RestudyRoundResult, ReviewCardResult } from '../../../shared/types';
import { LESSON_BY_ID, ORDER_OF } from '../content/curriculum';
import { softDelete, updateVersioned, withTx, type Queryable } from '../db/pool';
import { AppError, notFound } from '../lib/errors';
import { clampLimit, decodeCursor, localDate, paginate, uuid } from '../lib/util';
import {
  CardInput,
  CardPatchFields,
  CardState,
  DeleteQuery,
  IdParams,
  IsoDate,
  IsoDateTime,
  Nullable,
  PageQuery,
  ReviewRating as RatingSchema,
  Uuid,
  VersionedMeta,
  WriteMeta,
  partial,
} from '../schemas';
import { HARD_CARD, hardCount } from '../services/restudy';
import { loadSettings } from '../services/settings';
import { applyReview, cardToApi, emptySrs, fromRow, replay, reviewLogToApi, toColumns } from '../services/srs';
import { getExistingOrReject, pickSets } from './tasks';

type Row = Record<string, unknown>;
type CardIn = {
  id?: string;
  deck?: string;
  front: string;
  back: string;
  reading?: string | null;
  example?: string | null;
  exampleTranslation?: string | null;
  tags?: string[];
  source?: string;
  sourceRef?: string | null;
  jlptLevel?: string | null;
};

/** 未来时间容忍度：客户端时钟略快可以接受，快太多就是在穿越 */
const FUTURE_SKEW_MS = 5 * 60_000;

export async function insertCard(q: Queryable, userId: string, c: CardIn, deck: string, source: string): Promise<Row | null> {
  const s = emptySrs(new Date());
  const { rows } = await q.query(
    `INSERT INTO cards (id, user_id, deck, front, back, reading, example, example_translation, tags, source, source_ref, jlpt_level,
                        state, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, last_review_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    [
      c.id ?? uuid(), userId, c.deck ?? deck, c.front.trim(), c.back.trim(), c.reading ?? null, c.example ?? null,
      c.exampleTranslation ?? null, c.tags ?? [], c.source ?? source, c.sourceRef ?? null, c.jlptLevel ?? null,
      s.state, s.due, s.stability, s.difficulty, s.scheduled_days, s.learning_steps, s.reps, s.lapses, s.last_review_at,
    ],
  );
  return rows[0] ?? null;
}

export const cardRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /* ───────────── 重新学习（v1.9.0；v1.10.0 记成绩）：不碰复习进度 ───────────── */

  app.get('/cards/restudy', async (req): Promise<RestudyGroups> => {
    const { timezone: tz } = await loadSettings(app.db, req.userId);
    const days = await app.db.query(
      `SELECT d::text AS date, count(*)::int AS count FROM (
         SELECT l.card_id, min((l.reviewed_at AT TIME ZONE $2)::date) AS d
           FROM review_logs l JOIN cards c ON c.id = l.card_id AND c.deleted_at IS NULL
          WHERE l.user_id = $1 AND l.deleted_at IS NULL
          GROUP BY l.card_id
       ) t GROUP BY d ORDER BY d DESC LIMIT 90`,
      [req.userId, tz],
    );
    const byLesson = await app.db.query(
      `SELECT source_ref AS id, count(*)::int AS count FROM cards
        WHERE user_id = $1 AND deleted_at IS NULL AND source = 'lesson' AND source_ref IS NOT NULL GROUP BY source_ref`,
      [req.userId],
    );
    const lessons = byLesson.rows
      .flatMap((r) => {
        const def = LESSON_BY_ID.get(r.id as string);
        return def ? [{ lessonId: def.id, order: ORDER_OF.get(def.id)!, title: def.title, count: r.count as number }] : [];
      })
      .sort((a, b) => b.order - a.order);
    // 每组最近一次完整做的分数
    const last = await app.db.query(
      `SELECT DISTINCT ON (scope, scope_value) scope, scope_value, score FROM restudy_rounds
        WHERE user_id = $1 AND NOT partial ORDER BY scope, scope_value, created_at DESC`,
      [req.userId],
    );
    const lastOf = (scope: string, value: string | null) =>
      (last.rows.find((r) => r.scope === scope && r.scope_value === value)?.score as number | undefined) ?? null;
    return {
      days: (days.rows as RestudyGroups['days']).map((d) => ({ ...d, lastScore: lastOf('date', d.date) })),
      lessons: lessons.map((l) => ({ ...l, lastScore: lastOf('lesson', l.lessonId) })),
      hard: { count: await hardCount(app.db, req.userId), lastScore: lastOf('hard', null) },
    };
  });

  app.get(
    '/cards/restudy/items',
    { schema: { querystring: Type.Object({ date: Type.Optional(IsoDate), lessonId: Type.Optional(Type.String({ maxLength: 40 })), hard: Type.Optional(Type.Boolean()) }) } },
    async (req) => {
      const { date, lessonId, hard } = req.query;
      if ([date, lessonId, hard].filter(Boolean).length !== 1) throw new AppError('VALIDATION_FAILED', 'date、lessonId、hard 要给且只给一个');
      if (hard) {
        const r = await app.db.query(`SELECT c.* FROM cards c WHERE c.user_id = $1 AND ${HARD_CARD} ORDER BY c.lapses DESC, c.id LIMIT 500`, [req.userId]);
        return { items: r.rows.map(cardToApi) };
      }
      const { timezone: tz } = await loadSettings(app.db, req.userId);
      const { rows } = date
        ? await app.db.query(
            `SELECT c.* FROM cards c
              WHERE c.user_id = $1 AND c.deleted_at IS NULL
                AND (SELECT min((l.reviewed_at AT TIME ZONE $2)::date) FROM review_logs l WHERE l.card_id = c.id AND l.deleted_at IS NULL) = $3::date
              ORDER BY c.id LIMIT 500`,
            [req.userId, tz, date],
          )
        : await app.db.query(`SELECT * FROM cards WHERE user_id = $1 AND deleted_at IS NULL AND source = 'lesson' AND source_ref = $2 ORDER BY id LIMIT 500`, [req.userId, lessonId]);
      return { items: rows.map(cardToApi) };
    },
  );

  app.post(
    '/cards/restudy/rounds',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            scope: Type.Union([Type.Literal('date'), Type.Literal('lesson'), Type.Literal('hard')]),
            value: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
            partial: Type.Optional(Type.Boolean()),
            results: Type.Array(Type.Object({ cardId: Type.String({ format: 'uuid' }), known: Type.Boolean() }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply): Promise<RestudyRoundResult> => {
      const b = req.body;
      const value = b.scope === 'hard' ? null : (b.value ?? null);
      if (b.scope !== 'hard' && !value) throw new AppError('VALIDATION_FAILED', '这个范围要给 value', [{ path: '/value', message: '必填' }]);
      // 只认自己的卡；同一张重复提交只算第一次
      const owned = await app.db.query(`SELECT id FROM cards WHERE user_id = $1 AND id = ANY($2::uuid[])`, [req.userId, b.results.map((r) => r.cardId)]);
      const mine = new Set(owned.rows.map((r) => r.id as string));
      const seen = new Map<string, boolean>();
      for (const r of b.results) if (mine.has(r.cardId) && !seen.has(r.cardId)) seen.set(r.cardId, r.known);
      if (!seen.size) throw notFound('这些卡片不存在');
      const total = seen.size;
      const known = [...seen.values()].filter(Boolean).length;
      const score = Math.round((known / total) * 100);
      const prev = await app.db.query(
        `SELECT score FROM restudy_rounds WHERE user_id = $1 AND scope = $2 AND scope_value IS NOT DISTINCT FROM $3 AND NOT partial ORDER BY created_at DESC LIMIT 1`,
        [req.userId, b.scope, value],
      );
      const id = uuid();
      await withTx(app.db, async (tx) => {
        await tx.query(`INSERT INTO restudy_rounds (id, user_id, scope, scope_value, partial, total, known, score) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, req.userId, b.scope, value, b.partial ?? false, total, known, score]);
        await tx.query(
          `INSERT INTO restudy_results (round_id, user_id, card_id, known) SELECT $1, $2, x.id, x.known FROM unnest($3::uuid[], $4::boolean[]) AS x(id, known)`,
          [id, req.userId, [...seen.keys()], [...seen.values()]],
        );
      });
      return reply.code(201).send({ id, score, total, known, previousScore: (prev.rows[0]?.score as number | undefined) ?? null, hardLeft: await hardCount(app.db, req.userId) });
    },
  );

  /* ───────────── 到期 ───────────── */

  app.get(
    '/cards/due',
    {
      schema: {
        querystring: Type.Object({
          deck: Type.Optional(Type.String({ maxLength: 60 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
      },
    },
    async (req): Promise<DueCardsResponse> => {
      const settings = await loadSettings(app.db, req.userId);
      const limit = req.query.limit ?? 50;
      const deck = req.query.deck ?? null;
      const tz = settings.timezone;

      const today = await app.db.query(
        `SELECT count(*) FILTER (WHERE state_before = 'new')::int AS learned,
                count(*) FILTER (WHERE state_before <> 'new')::int AS reviewed
           FROM review_logs
          WHERE user_id = $1 AND deleted_at IS NULL
            AND (reviewed_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
        [req.userId, tz],
      );
      const newQuota = Math.max(0, settings.newCardsPerDay - today.rows[0].learned);
      const reviewQuota = Math.max(0, settings.reviewLimitPerDay - today.rows[0].reviewed);

      const base = `user_id = $1 AND deleted_at IS NULL AND NOT suspended AND ($2::text IS NULL OR deck = $2)`;
      const [learning, review, fresh, counts] = await Promise.all([
        app.db.query(`SELECT * FROM cards WHERE ${base} AND state IN ('learning','relearning') AND due <= now() ORDER BY due LIMIT $3`, [req.userId, deck, limit]),
        app.db.query(`SELECT * FROM cards WHERE ${base} AND state = 'review' AND due <= now() ORDER BY due LIMIT $3`, [req.userId, deck, Math.min(limit, reviewQuota)]),
        // 新卡按天打乱（同一天顺序稳定）：按加入顺序出卡，あいうえお 背着背着就猜出来了
        app.db.query(`SELECT * FROM cards WHERE ${base} AND state = 'new' ORDER BY md5(id::text || $4), id LIMIT $3`, [req.userId, deck, Math.min(limit, newQuota), localDate(tz)]),
        app.db.query(
          `SELECT count(*) FILTER (WHERE state IN ('learning','relearning') AND due <= now())::int AS learning,
                  count(*) FILTER (WHERE state = 'review' AND due <= now())::int AS review,
                  count(*) FILTER (WHERE state = 'new')::int AS new
             FROM cards WHERE ${base}`,
          [req.userId, deck],
        ),
      ]);
      // 先学习中的（短间隔，最怕拖），再到期复习，最后新卡
      const items = [...learning.rows, ...review.rows, ...fresh.rows].slice(0, limit).map(cardToApi);
      const n = counts.rows[0];
      return {
        items,
        counts: { new: Math.min(n.new, newQuota), learning: n.learning, review: Math.min(n.review, reviewQuota) },
      };
    },
  );

  app.get('/cards/decks', async (req) => {
    const { rows } = await app.db.query(
      `SELECT deck, count(*)::int AS total,
              count(*) FILTER (WHERE state <> 'new' AND due <= now() AND NOT suspended)::int AS due,
              count(*) FILTER (WHERE state = 'new' AND NOT suspended)::int AS new
         FROM cards WHERE user_id = $1 AND deleted_at IS NULL
        GROUP BY deck ORDER BY deck`,
      [req.userId],
    );
    return { items: rows };
  });

  /* ───────────── 导入 ───────────── */

  app.post(
    '/cards/import',
    {
      bodyLimit: 5 * 1024 * 1024,
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            deck: Type.String({ minLength: 1, maxLength: 60 }),
            cards: Type.Array(CardInput, { minItems: 1, maxItems: CARD_IMPORT_MAX }),
            updateExisting: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<ImportCardsResult> => {
      const { deck, cards, updateExisting } = req.body;
      return withTx(app.db, async (tx) => {
        const result: ImportCardsResult = { created: 0, updated: 0, skipped: 0, errors: [] };
        const { rows: existing } = await tx.query(
          'SELECT id, deck, front FROM cards WHERE user_id = $1 AND deleted_at IS NULL',
          [req.userId],
        );
        const byKey = new Map(existing.map((r) => [`${r.deck}\u0000${r.front}`, r.id as string]));
        const seen = new Set<string>();

        for (let i = 0; i < cards.length; i++) {
          const c = cards[i] as CardIn;
          const key = `${c.deck ?? deck}\u0000${c.front.trim()}`;
          if (seen.has(key)) {
            result.skipped++;
            result.errors.push({ index: i, message: '与本次导入中的前一张卡重复' });
            continue;
          }
          seen.add(key);
          const existingId = byKey.get(key);
          if (existingId) {
            if (!updateExisting) {
              result.skipped++;
              continue;
            }
            await tx.query(
              `UPDATE cards SET back = $3, reading = $4, example = $5, example_translation = $6, tags = $7, jlpt_level = $8,
                                version = version + 1
                WHERE id = $1 AND user_id = $2`,
              [existingId, req.userId, c.back.trim(), c.reading ?? null, c.example ?? null, c.exampleTranslation ?? null, c.tags ?? [], c.jlptLevel ?? null],
            );
            result.updated++;
            continue;
          }
          const row = await insertCard(tx, req.userId, c, deck, 'import');
          if (row) result.created++;
          else {
            result.skipped++;
            result.errors.push({ index: i, message: 'id 已存在' });
          }
        }
        return result;
      });
    },
  );

  /* ───────────── 列表与单卡 ───────────── */

  app.get(
    '/cards',
    {
      schema: {
        querystring: Type.Object({
          deck: Type.Optional(Type.String({ maxLength: 60 })),
          q: Type.Optional(Type.String({ maxLength: 100 })),
          state: Type.Optional(CardState),
          tag: Type.Optional(Type.String({ maxLength: 30 })),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      const { deck, q, state, tag, cursor, limit } = req.query;
      const lim = clampLimit(limit);
      const c = decodeCursor(cursor);
      const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
      const { rows } = await app.db.query(
        `SELECT * FROM cards
          WHERE user_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR deck = $2)
            AND ($3::text IS NULL OR front ILIKE $3 OR back ILIKE $3 OR reading ILIKE $3)
            AND ($4::text IS NULL OR state = $4)
            AND ($5::text IS NULL OR $5 = ANY (tags))
            AND ($6::timestamptz IS NULL OR (created_at, id) < ($6::timestamptz, $7::uuid))
          ORDER BY created_at DESC, id DESC LIMIT $8`,
        [req.userId, deck ?? null, like, state ?? null, tag ?? null, c ? c.k[0] : null, c ? c.id : null, lim + 1],
      );
      const page = paginate(rows, lim, (r) => ({ k: [(r.created_at as Date).toISOString()], id: r.id as string }));
      return { items: page.items.map(cardToApi), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/cards',
    { schema: { body: Type.Composite([Type.Object(WriteMeta), CardInput], { additionalProperties: false }) } },
    async (req, reply) => {
      const settings = await loadSettings(app.db, req.userId);
      const body = req.body as CardIn;
      const row = (await insertCard(app.db, req.userId, body, settings.defaultDeck, 'manual')) ??
        (await getExistingOrReject(app.db, 'cards', req.userId, body.id!));
      return reply.code(201).send(cardToApi(row));
    },
  );

  app.patch(
    '/cards/:id',
    { schema: { params: IdParams, body: Type.Object({ ...VersionedMeta, ...partial(CardPatchFields) }, { additionalProperties: false }) } },
    async (req) => {
      const sets = pickSets(req.body, ['deck', 'front', 'back', 'reading', 'example', 'exampleTranslation', 'tags', 'jlptLevel', 'suspended']);
      return cardToApi(await updateVersioned(app.db, 'cards', req.userId, req.params.id, req.body.baseVersion, sets, cardToApi));
    },
  );

  app.delete('/cards/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'cards', req.userId, req.params.id, req.query.baseVersion, cardToApi);
    return reply.code(204).send();
  });

  /* ───────────── 复习 ───────────── */

  app.post(
    '/cards/:id/review',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            ...WriteMeta,
            id: Type.Optional(Uuid),
            rating: RatingSchema,
            reviewedAt: IsoDateTime,
            durationMs: Type.Integer({ minimum: 0, maximum: 3_600_000 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<ReviewCardResult> => {
      const reviewedAt = new Date(req.body.reviewedAt);
      if (reviewedAt.getTime() > Date.now() + FUTURE_SKEW_MS) {
        throw new AppError('VALIDATION_FAILED', '复习时间不能晚于当前时间', [{ path: '/reviewedAt', message: '来自未来' }]);
      }
      const rating = req.body.rating as ReviewRating;
      const logId = req.body.id ?? uuid();
      const { desiredRetention } = await loadSettings(app.db, req.userId);

      return withTx(app.db, async (tx) => {
        const { rows } = await tx.query(
          'SELECT * FROM cards WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
          [req.params.id, req.userId],
        );
        const card = rows[0];
        if (!card) throw notFound();

        // 同一条复习记录（离线重推）：不重复计入
        const dup = await tx.query('SELECT * FROM review_logs WHERE id = $1', [logId]);
        if (dup.rows[0]) {
          if (dup.rows[0].user_id !== req.userId || dup.rows[0].card_id !== card.id) throw new AppError('UNPROCESSABLE', 'id 已被占用');
          return { card: cardToApi(card), log: reviewLogToApi(dup.rows[0]) };
        }

        const last = card.last_review_at as Date | null;
        let updatedCols;
        let logRow: Row;
        if (!last || reviewedAt >= last) {
          const before = card.state as string;
          const next = applyReview(desiredRetention, fromRow(card), reviewedAt, rating);
          updatedCols = toColumns(next);
          const ins = await tx.query(
            `INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, state_before, scheduled_days_after)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [logId, req.userId, card.id, rating, reviewedAt, req.body.durationMs, before, next.scheduled_days],
          );
          logRow = ins.rows[0];
        } else {
          // 迟到的离线复习：插入后按时间重演整段历史
          await tx.query(
            `INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, state_before, scheduled_days_after)
             VALUES ($1, $2, $3, $4, $5, $6, 'new', 0)`,
            [logId, req.userId, card.id, rating, reviewedAt, req.body.durationMs],
          );
          const { rows: logs } = await tx.query(
            'SELECT * FROM review_logs WHERE card_id = $1 AND deleted_at IS NULL ORDER BY reviewed_at, created_at, id',
            [card.id],
          );
          const r = replay(
            desiredRetention,
            card.created_at as Date,
            logs.map((l) => ({ reviewedAt: l.reviewed_at as Date, rating: l.rating as ReviewRating })),
          );
          for (let i = 0; i < logs.length; i++) {
            const s = r.steps[i];
            if (logs[i].state_before !== s.stateBefore || logs[i].scheduled_days_after !== s.scheduledDaysAfter) {
              await tx.query('UPDATE review_logs SET state_before = $2, scheduled_days_after = $3 WHERE id = $1', [
                logs[i].id, s.stateBefore, s.scheduledDaysAfter,
              ]);
            }
          }
          updatedCols = toColumns(r.card);
          logRow = (await tx.query('SELECT * FROM review_logs WHERE id = $1', [logId])).rows[0];
        }

        const u = updatedCols;
        const { rows: updated } = await tx.query(
          `UPDATE cards SET state = $3, due = $4, stability = $5, difficulty = $6, scheduled_days = $7,
                            learning_steps = $8, reps = $9, lapses = $10, last_review_at = $11
            WHERE id = $1 AND user_id = $2 RETURNING *`,
          [card.id, req.userId, u.state, u.due, u.stability, u.difficulty, u.scheduled_days, u.learning_steps, u.reps, u.lapses, u.last_review_at],
        );
        return { card: cardToApi(updated[0]), log: reviewLogToApi(logRow) };
      });
    },
  );
};
