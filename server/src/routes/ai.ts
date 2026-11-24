/**
 * AI 查询：查词 / 语法 / 汉字，附 3 例句 + 3 道选择题。
 * 解释按 type + 查询词（+ 语境）跨用户缓存；题目每次查询都新开一份测验，答案只留在服务端。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { LOOKUP_TYPES, QUIZ_TTL_HOURS, type LookupType, type MistakeCategory } from '../../../shared/constants';
import type { LookupResult, QuizCheckResult } from '../../../shared/types';
import { withTx, type Queryable } from '../db/pool';
import { AppError, notFound } from '../lib/errors';
import { sha256, uuid } from '../lib/util';
import { Lit, Uuid, WriteMeta } from '../schemas';
import { aiLookup, splitLookup, toStoredQuestions, type LookupPayload, type StoredQuestion } from '../services/aiTasks';
import { userAi } from '../services/aiKeys';
import { bumpMistake, upsertMistake } from './mistakes';

/** 缓存键：全角半角、大小写、多余空白都不该让同一个词查两次 */
export const normalizeQuery = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 缓存多久后重新请 AI 讲一遍（解释可能随模型升级而变好） */
const CACHE_DAYS = 30;

const LOOKUP_CATEGORY: Record<LookupType, MistakeCategory> = { word: 'vocab', grammar: 'grammar', kanji: 'kanji' };

async function createQuiz(q: Queryable, userId: string, source: 'lookup' | 'retry', sourceRef: string, questions: StoredQuestion[]) {
  const quizId = uuid();
  const expiresAt = new Date(Date.now() + QUIZ_TTL_HOURS * 3600_000);
  await q.query('INSERT INTO quizzes (id, user_id, source, source_ref, questions, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    quizId, userId, source, sourceRef, JSON.stringify(questions), expiresAt,
  ]);
  return { quizId, expiresAt: expiresAt.toISOString(), questions: questions.map(({ id, stem, options }) => ({ id, stem, options })) };
}

export const aiRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/ai/lookup',
    {
      // 查询不改用户数据，不需要 clientOpId
      config: { idempotent: false, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: Type.Object(
          {
            type: Lit(LOOKUP_TYPES),
            query: Type.String({ minLength: 1, maxLength: 60 }),
            context: Type.Optional(Type.String({ maxLength: 300 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<LookupResult> => {
      const type = req.body.type as LookupType;
      const query = req.body.query.trim();
      const context = req.body.context?.trim() || undefined;
      const key = [type, normalizeQuery(query), context ? sha256(normalizeQuery(context)) : ''];
      if (!key[1]) throw new AppError('VALIDATION_FAILED', '查询内容不能为空', [{ path: '/query', message: '不能为空' }]);

      const hit = await app.db.query(
        `SELECT result FROM ai_lookup_cache
          WHERE type = $1 AND query_norm = $2 AND context_hash = $3 AND created_at > now() - make_interval(days => $4)`,
        [...key, CACHE_DAYS],
      );
      let payload: LookupPayload;
      const cached = !!hit.rows[0];
      if (cached) {
        payload = hit.rows[0].result;
      } else {
        const r = await aiLookup(await userAi(app, req.userId), type, query, context);
        payload = r.data;
        await app.db.query(
          `INSERT INTO ai_lookup_cache (type, query_norm, context_hash, result, model) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (type, query_norm, context_hash) DO UPDATE SET result = EXCLUDED.result, model = EXCLUDED.model, created_at = now()`,
          [...key, JSON.stringify(payload), r.model],
        );
      }

      const { body, examples, questions } = splitLookup(payload);
      const quiz = await createQuiz(app.db, req.userId, 'lookup', `${type}:${query}`, toStoredQuestions(questions));
      return { type, query, ...body, examples, quiz, cached } as LookupResult;
    },
  );

  app.post(
    '/ai/quiz/check',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            quizId: Uuid,
            answers: Type.Array(
              Type.Object(
                { questionId: Type.String({ maxLength: 20 }), choiceIndex: Type.Integer({ minimum: 0, maximum: 3 }) },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 10 },
            ),
            recordMistakes: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<QuizCheckResult> => {
      const { rows } = await app.db.query('SELECT * FROM quizzes WHERE id = $1 AND user_id = $2 AND expires_at > now()', [
        req.body.quizId,
        req.userId,
      ]);
      const quiz = rows[0];
      if (!quiz) throw notFound('测验不存在或已过期，请重新查询');
      const questions = quiz.questions as StoredQuestion[];
      const byId = new Map(questions.map((q) => [q.id, q]));
      for (const a of req.body.answers) {
        if (!byId.has(a.questionId)) {
          throw new AppError('VALIDATION_FAILED', '题号不存在', [{ path: '/answers', message: `未知题号 ${a.questionId}` }]);
        }
      }
      const record = req.body.recordMistakes ?? true;
      const [type, ...rest] = String(quiz.source_ref ?? '').split(':');

      return withTx(app.db, async (tx) => {
        const results: QuizCheckResult['results'] = [];
        for (const a of req.body.answers) {
          const q = byId.get(a.questionId)!;
          const correct = a.choiceIndex === q.answerIndex;
          let mistakeId: string | null = null;
          if (!correct && record) {
            if (quiz.source === 'retry') {
              // 变式题答错：记在原错题头上，不另起一条
              if (await bumpMistake(tx, req.userId, quiz.source_ref)) mistakeId = quiz.source_ref;
            } else {
              const { row } = await upsertMistake(tx, req.userId, {
                category: q.category ?? LOOKUP_CATEGORY[type as LookupType] ?? 'other',
                source: 'quiz',
                sourceRef: `lookup:${type}:${rest.join(':')}`.slice(0, 200),
                // 只记题干：选项每次洗牌顺序不同，带上选项就没法按"同一道题"去重了
                question: q.stem,
                wrongAnswer: q.options[a.choiceIndex] ?? '',
                correctAnswer: q.options[q.answerIndex],
                explanationZh: q.explanationZh,
              });
              mistakeId = row.id as string;
            }
          }
          // 统计用的作答明细：同一题重复提交以最后一次为准
          await tx.query(
            `INSERT INTO quiz_answers (user_id, quiz_id, question_id, correct) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, quiz_id, question_id) DO UPDATE SET correct = EXCLUDED.correct, answered_at = now()`,
            [req.userId, quiz.id, q.id, correct],
          );
          results.push({ questionId: q.id, correct, choiceIndex: a.choiceIndex, answerIndex: q.answerIndex, explanationZh: q.explanationZh, mistakeId });
        }
        return { correctCount: results.filter((r) => r.correct).length, total: questions.length, results };
      });
    },
  );
};
