/**
 * 错题本：同一道题（question + correctAnswer）只留一条，再错就累加 errorCount。
 * 一键重出：AI 围绕同一知识点出变式题，判分走 /ai/quiz/check，答错时回头累加原错题。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { MISTAKE_CATEGORIES, MISTAKE_SORTS, MISTAKE_SOURCES, QUIZ_TTL_HOURS, type MistakeSort } from '../../../shared/constants';
import type { Mistake, RetryMistakeResult } from '../../../shared/types';
import { getOwned, softDelete, updateVersioned, withTx, type Queryable } from '../db/pool';
import { camelRow, clampLimit, decodeCursor, paginate, uuid } from '../lib/util';
import { DeleteQuery, IdParams, Lit, Nullable, PageQuery, Uuid, VersionedMeta, WriteMeta } from '../schemas';
import { aiRetryQuestions, toStoredQuestions } from '../services/aiTasks';
import { userAi } from '../services/aiKeys';
import { getExistingOrReject, pickSets } from './tasks';

type Row = Record<string, unknown>;

export const mistakeToApi = (row: Row) => camelRow<Mistake>(row);

const Category = Lit(MISTAKE_CATEGORIES);
const Tags = Type.Array(Type.String({ maxLength: 30 }), { maxItems: 20 });
const Explanation = Nullable(Type.String({ maxLength: 2000 }));

export interface MistakeInput {
  id?: string;
  category: string;
  source?: string;
  sourceRef?: string | null;
  question: string;
  wrongAnswer: string;
  correctAnswer: string;
  explanationZh?: string | null;
  tags?: string[];
}

/**
 * 新错题插入；已有同题则 errorCount+1、刷新最近错误时间与错误答案，并取消"已掌握"。
 * 返回行与是否新建。
 */
export async function upsertMistake(q: Queryable, userId: string, m: MistakeInput): Promise<{ row: Row; created: boolean }> {
  try {
    const { rows } = await q.query(
      `INSERT INTO mistakes (id, user_id, category, source, source_ref, question, wrong_answer, correct_answer, explanation_zh, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id, md5(question || chr(31) || correct_answer)) WHERE deleted_at IS NULL
       DO UPDATE SET error_count = mistakes.error_count + 1, last_wrong_at = now(), wrong_answer = EXCLUDED.wrong_answer,
                     mastered = false, mastered_at = NULL, version = mistakes.version + 1
       RETURNING *, (xmax = 0) AS inserted`,
      [
        m.id ?? uuid(), userId, m.category, m.source ?? 'manual', m.sourceRef ?? null, m.question.trim(), m.wrongAnswer.trim(),
        m.correctAnswer.trim(), m.explanationZh ?? null, m.tags ?? [],
      ],
    );
    const { inserted, ...row } = rows[0];
    return { row, created: inserted as boolean };
  } catch (e) {
    // 客户端自带的 id 已存在（离线重推）：同一用户的就原样返回
    if ((e as { code?: string; constraint?: string }).code === '23505' && m.id) {
      return { row: await getExistingOrReject(q, 'mistakes', userId, m.id), created: false };
    }
    throw e;
  }
}

/** 重做再错：只累加，不改题目内容 */
export async function bumpMistake(q: Queryable, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `UPDATE mistakes SET error_count = error_count + 1, last_wrong_at = now(), mastered = false, mastered_at = NULL, version = version + 1
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId],
  );
  return !!rowCount;
}

const SORTS: Record<MistakeSort, { order: string; key: (r: Row) => unknown[]; after: string }> = {
  errorCountDesc: {
    order: 'error_count DESC, last_wrong_at DESC, id DESC',
    key: (r) => [r.error_count, (r.last_wrong_at as Date).toISOString()],
    after: '(error_count, last_wrong_at, id) < ($6::int, $7::timestamptz, $8::uuid)',
  },
  lastWrongDesc: {
    order: 'last_wrong_at DESC, id DESC',
    key: (r) => [(r.last_wrong_at as Date).toISOString()],
    after: '(last_wrong_at, id) < ($7::timestamptz, $8::uuid)',
  },
  createdDesc: {
    order: 'created_at DESC, id DESC',
    key: (r) => [(r.created_at as Date).toISOString()],
    after: '(created_at, id) < ($7::timestamptz, $8::uuid)',
  },
};

export const mistakeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/mistakes',
    {
      schema: {
        querystring: Type.Object({
          category: Type.Optional(Category),
          source: Type.Optional(Lit(MISTAKE_SOURCES)),
          mastered: Type.Optional(Type.Boolean()),
          sort: Type.Optional(Lit(MISTAKE_SORTS)),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      const { category, source, mastered, cursor, limit } = req.query;
      const sort = SORTS[(req.query.sort ?? 'lastWrongDesc') as MistakeSort];
      const lim = clampLimit(limit);
      const c = decodeCursor(cursor);
      // 游标的 k 依排序方式不同：errorCountDesc 为 [count, time]，其余为 [time]
      const [kCount, kTime] = c ? (c.k.length === 2 ? c.k : [null, c.k[0]]) : [null, null];
      const { rows } = await app.db.query(
        `SELECT * FROM mistakes
          WHERE user_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR category = $2)
            AND ($3::text IS NULL OR source = $3)
            AND ($4::boolean IS NULL OR mastered = $4)
            AND ($5::boolean OR ${sort.after})
            AND ($6::int IS NULL OR TRUE) -- 时间类排序用不到 $6，也要给它一个类型
          ORDER BY ${sort.order} LIMIT $9`,
        [req.userId, category ?? null, source ?? null, mastered ?? null, !c, kCount, kTime, c?.id ?? null, lim + 1],
      );
      const page = paginate(rows, lim, (r) => ({ k: sort.key(r), id: r.id as string }));
      return { items: page.items.map(mistakeToApi), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/mistakes',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            id: Type.Optional(Uuid),
            category: Category,
            source: Type.Optional(Lit(MISTAKE_SOURCES)),
            sourceRef: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
            question: Type.String({ minLength: 1, maxLength: 1000 }),
            wrongAnswer: Type.String({ maxLength: 1000 }),
            correctAnswer: Type.String({ minLength: 1, maxLength: 1000 }),
            explanationZh: Type.Optional(Explanation),
            tags: Type.Optional(Tags),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const { row, created } = await upsertMistake(app.db, req.userId, req.body);
      return reply.code(created ? 201 : 200).send(mistakeToApi(row));
    },
  );

  app.patch(
    '/mistakes/:id',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            ...VersionedMeta,
            category: Type.Optional(Category),
            explanationZh: Type.Optional(Explanation),
            mastered: Type.Optional(Type.Boolean()),
            tags: Type.Optional(Tags),
            incrementError: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false, minProperties: 2 },
        ),
      },
    },
    async (req) => {
      const sets = pickSets(req.body, ['category', 'explanationZh', 'tags']);
      const { mastered, incrementError } = req.body;
      if (incrementError) {
        // 重做再错：必然回到"未掌握"
        Object.assign(sets, { last_wrong_at: new Date(), mastered: false, mastered_at: null });
      } else if (mastered !== undefined) {
        Object.assign(sets, { mastered, mastered_at: mastered ? new Date() : null });
      }
      return withTx(app.db, async (tx) => {
        // 乐观锁先过其余列；自增是相对值，不能放进"按值赋值"的 sets 里
        const row = await updateVersioned(tx, 'mistakes', req.userId, req.params.id, req.body.baseVersion, sets, mistakeToApi);
        if (!incrementError) return mistakeToApi(row);
        const { rows } = await tx.query('UPDATE mistakes SET error_count = error_count + 1 WHERE id = $1 RETURNING *', [row.id]);
        return mistakeToApi(rows[0]);
      });
    },
  );

  app.delete('/mistakes/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'mistakes', req.userId, req.params.id, req.query.baseVersion, mistakeToApi);
    return reply.code(204).send();
  });

  app.post(
    '/mistakes/:id/retry',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: IdParams, body: Type.Object(WriteMeta, { additionalProperties: false }) },
    },
    async (req): Promise<RetryMistakeResult> => {
      const m = await getOwned(app.db, 'mistakes', req.userId, req.params.id);
      const questions = toStoredQuestions(
        await aiRetryQuestions(await userAi(app, req.userId), {
          category: m.category as string,
          question: m.question as string,
          wrongAnswer: m.wrong_answer as string,
          correctAnswer: m.correct_answer as string,
          explanationZh: m.explanation_zh as string | null,
        }),
      );
      const quizId = uuid();
      const expiresAt = new Date(Date.now() + QUIZ_TTL_HOURS * 3600_000);
      await app.db.query(
        `INSERT INTO quizzes (id, user_id, source, source_ref, questions, expires_at) VALUES ($1, $2, 'retry', $3, $4, $5)`,
        [quizId, req.userId, m.id, JSON.stringify(questions), expiresAt],
      );
      return {
        mistakeId: m.id as string,
        quiz: { quizId, expiresAt: expiresAt.toISOString(), questions: questions.map(({ id, stem, options, audio }) => ({ id, stem, options, audio })) },
      };
    },
  );
};
