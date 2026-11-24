/**
 * 课程体系与学习计划（契约 §14）。
 * 课程过关：先 /ai/quiz/check 判每题，再 /lessons/{id}/complete 按作答记录计分 —— 分数以服务端为准。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { CURRICULUM_PARTS, QUIZ_TTL_HOURS, REMINDER_TIME_PATTERN, START_LEVELS, STUDY_GOALS } from '../../../shared/constants';
import type { CompleteLessonResult, DailyRoute, StageInfo, Lesson, LessonPracticeResult, LessonProgress, PlanPreview, StudyPlanInput } from '../../../shared/types';
import { LESSON_BY_ID } from '../content/curriculum';
import { withTx } from '../db/pool';
import { AppError, notFound, versionConflict } from '../lib/errors';
import { camelRow, localDate, uuid } from '../lib/util';
import { IsoDate, Lit, Uuid, VersionedMeta, WriteMeta } from '../schemas';
import { userAi } from '../services/aiKeys';
import { lessonFor, loadPlan, planToApi, planToday, preview, progressMap, scoreOf, summaries } from '../services/learning';
import { loadSettings } from '../services/settings';
import { dailyRoute, seedLessonCards, stageInfo } from '../services/loop';

type Row = Record<string, unknown>;

export const lessonProgressToApi = (r: Row) => camelRow<LessonProgress>(r);

const PlanFields = {
  startLevel: Lit(START_LEVELS),
  goal: Lit(STUDY_GOALS),
  targetDate: IsoDate,
  dailyMinutes: Type.Integer({ minimum: 10, maximum: 600 }),
  reminderTime: Type.Union([Type.String({ pattern: REMINDER_TIME_PATTERN }), Type.Null()]),
  lateReminder: Type.Boolean(),
};

export const learnRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /* ───────────── 课程体系 ───────────── */

  app.get('/curriculum', { schema: { querystring: Type.Object({ part: Type.Optional(Lit(CURRICULUM_PARTS)) }) } }, async (req) => {
    const all = await summaries(app.db, req.userId);
    return { items: req.query.part ? all.filter((l) => l.part === req.query.part) : all };
  });

  app.get(
    '/lessons/:lessonId',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { params: Type.Object({ lessonId: Type.String({ maxLength: 40 }) }) } },
    async (req): Promise<Lesson> => {
      const { lesson, questions } = await lessonFor(app.db, () => userAi(app, req.userId), req.userId, req.params.lessonId);
      const quizId = uuid();
      const expiresAt = new Date(Date.now() + QUIZ_TTL_HOURS * 3600_000);
      await app.db.query(`INSERT INTO quizzes (id, user_id, source, source_ref, questions, expires_at) VALUES ($1, $2, 'lesson', $3, $4, $5)`, [
        quizId, req.userId, lesson.id, JSON.stringify(questions), expiresAt,
      ]);
      return { ...lesson, quiz: { quizId, expiresAt: expiresAt.toISOString(), questions: questions.map(({ id, stem, options }) => ({ id, stem, options })) } };
    },
  );

  app.post(
    '/lessons/:lessonId/complete',
    {
      schema: {
        params: Type.Object({ lessonId: Type.String({ maxLength: 40 }) }),
        body: Type.Object({ ...WriteMeta, quizId: Uuid }, { additionalProperties: false }),
      },
    },
    async (req): Promise<CompleteLessonResult> => {
      const def = LESSON_BY_ID.get(req.params.lessonId);
      if (!def) throw notFound('这一课不存在');
      const { rows } = await app.db.query(`SELECT * FROM quizzes WHERE id = $1 AND user_id = $2 AND source = 'lesson' AND source_ref = $3`, [
        req.body.quizId, req.userId, def.id,
      ]);
      const quiz = rows[0];
      if (!quiz) throw notFound('找不到这一课的小测，请重新打开课程');
      const answers = await app.db.query('SELECT question_id, correct FROM quiz_answers WHERE user_id = $1 AND quiz_id = $2', [req.userId, quiz.id]);
      if (!answers.rows.length) throw new AppError('UNPROCESSABLE', '还没有作答，先交卷再完成');
      const { score, passed } = scoreOf(quiz.questions, answers.rows as Array<{ question_id: string; correct: boolean }>);

      return withTx(app.db, async (tx) => {
        const prev = (await tx.query('SELECT * FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2 FOR UPDATE', [req.userId, def.id])).rows[0];
        const firstPass = passed && prev?.status !== 'passed';
        const { rows: saved } = await tx.query(
          `INSERT INTO lesson_progress (id, user_id, lesson_id, status, best_score, passed_at, attempts)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (user_id, lesson_id) DO UPDATE SET
             status = CASE WHEN lesson_progress.status = 'passed' THEN 'passed' ELSE EXCLUDED.status END,
             best_score = GREATEST(COALESCE(lesson_progress.best_score, 0), EXCLUDED.best_score),
             passed_at = COALESCE(lesson_progress.passed_at, EXCLUDED.passed_at),
             attempts = lesson_progress.attempts + 1,
             version = lesson_progress.version + 1
           RETURNING *`,
          [uuid(), req.userId, def.id, passed ? 'passed' : 'available', score, passed ? new Date() : null],
        );

        // 过关后线路前进一站：把新进入范围的课的词预设进抽认卡（每课只放一次）
        const cardsAdded = firstPass ? await seedLessonCards(tx, req.userId) : 0;
        const all = await summaries(tx, req.userId);
        const idx = all.findIndex((l) => l.id === def.id);
        const next = all.slice(idx + 1).find((l) => l.status !== 'passed') ?? null;
        return { progress: lessonProgressToApi(saved[0]), score, passed, cardsAdded, nextLesson: next };
      });
    },
  );

  /* ───────────── 本课练习与今日路线（v1.5.0） ───────────── */

  app.post(
    '/lessons/:lessonId/practice',
    {
      schema: {
        params: Type.Object({ lessonId: Type.String({ maxLength: 40 }) }),
        body: Type.Object({ ...WriteMeta, correct: Type.Integer({ minimum: 0, maximum: 200 }), total: Type.Integer({ minimum: 1, maximum: 200 }) }, { additionalProperties: false }),
      },
    },
    async (req): Promise<LessonPracticeResult> => {
      const def = LESSON_BY_ID.get(req.params.lessonId);
      if (!def) throw notFound('这一课不存在');
      const { correct, total } = req.body;
      if (correct > total) throw new AppError('VALIDATION_FAILED', '答对数不能多于总题数', [{ path: '/correct', message: '大于 total' }]);
      const score = Math.round((correct / total) * 100);
      const { rows } = await app.db.query(
        `INSERT INTO lesson_progress (id, user_id, lesson_id, status, practice_best, practiced_at)
         VALUES ($1, $2, $3, 'available', $4, now())
         ON CONFLICT (user_id, lesson_id) DO UPDATE SET
           practice_best = GREATEST(COALESCE(lesson_progress.practice_best, 0), EXCLUDED.practice_best),
           practiced_at = now(), deleted_at = NULL, version = lesson_progress.version + 1
         RETURNING *`,
        [uuid(), req.userId, def.id, score],
      );
      return { progress: lessonProgressToApi(rows[0]), score };
    },
  );

  app.get('/route/today', async (req): Promise<DailyRoute> => dailyRoute(app.db, req.userId));

  app.get('/learn/stage', async (req): Promise<StageInfo> => stageInfo(app.db, req.userId));

  /* ───────────── 学习计划 ───────────── */

  app.post('/plan/preview', { config: { idempotent: false }, schema: { body: Type.Object(PlanFields, { additionalProperties: false }) } }, async (req): Promise<PlanPreview> => {
    const { timezone } = await loadSettings(app.db, req.userId);
    const prog = await progressMap(app.db, req.userId);
    const passed = new Set([...prog].filter(([, v]) => v.status === 'passed').map(([k]) => k));
    return preview(req.body as StudyPlanInput, localDate(timezone), passed);
  });

  app.get('/plan', async (req) => {
    const row = await loadPlan(app.db, req.userId);
    if (!row) throw notFound('还没有学习计划');
    return planToApi(row);
  });

  app.put('/plan', { schema: { body: Type.Object({ ...VersionedMeta, ...PlanFields }, { additionalProperties: false }) } }, async (req) => {
    const b = req.body as StudyPlanInput & { baseVersion?: number };
    const { timezone } = await loadSettings(app.db, req.userId);
    const today = localDate(timezone);
    if (b.targetDate < today) throw new AppError('VALIDATION_FAILED', '截止日期不能早于今天', [{ path: '/targetDate', message: '早于今天' }]);
    return withTx(app.db, async (tx) => {
      const prev = await loadPlan(tx, req.userId);
      if (prev && b.baseVersion !== undefined && b.baseVersion !== prev.version) throw versionConflict(prev.version as number, planToApi(prev));
      const { rows } = await tx.query(
        `INSERT INTO study_plans (id, user_id, start_level, goal, start_date, target_date, daily_minutes, reminder_time, late_reminder)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id) DO UPDATE SET start_level = EXCLUDED.start_level, goal = EXCLUDED.goal, target_date = EXCLUDED.target_date,
           daily_minutes = EXCLUDED.daily_minutes, reminder_time = EXCLUDED.reminder_time, late_reminder = EXCLUDED.late_reminder,
           deleted_at = NULL, version = study_plans.version + 1
         RETURNING *`,
        [uuid(), req.userId, b.startLevel, b.goal, today, b.targetDate, b.dailyMinutes, b.reminderTime, b.lateReminder],
      );
      // 定好计划就有卡可背：起点那一课（和下一课）的词先放进牌组
      await seedLessonCards(tx, req.userId);
      return planToApi(rows[0]);
    });
  });

  app.get('/plan/today', async (req) => {
    const { timezone } = await loadSettings(app.db, req.userId);
    return planToday(app.db, req.userId, timezone);
  });
};
