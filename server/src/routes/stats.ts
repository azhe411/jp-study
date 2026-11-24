/**
 * 统计与它的两条源头：学习时长（time-logs）与 JLPT 模考成绩（jlpt-mocks）。
 * 其余指标（错题、对话、写作、朗读、词汇量、场景掌握）直接从各模块的记录里汇总。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { SCENARIO_CATEGORIES, SCENARIO_MASTERY_SCORE, type StudyModule } from '../../../shared/constants';
import type { JlptMock, StatsResponse, TimeLog } from '../../../shared/types';
import { SCENARIOS } from '../content/scenarios';
import { softDelete } from '../db/pool';
import { AppError } from '../lib/errors';
import { addDays, camelRow, clampLimit, decodeCursor, localDate, paginate, uuid } from '../lib/util';
import { DeleteQuery, IdParams, IsoDate, IsoDateTime, JlptLevel, PageQuery, StudyModule as ModuleSchema, Uuid, WriteMeta } from '../schemas';
import { loadSettings } from '../services/settings';
import { getExistingOrReject } from './tasks';

type Row = Record<string, unknown>;

const MAX_RANGE_DAYS = 366;

export const timeLogToApi = (row: Row): TimeLog => {
  const { id, module, startedAt, durationMs, createdAt } = camelRow<TimeLog>(row);
  return { id, module, startedAt, durationMs, createdAt };
};
export const mockToApi = (row: Row) => camelRow<JlptMock>(row);

/** 连续天数：今天还没学不算断，从昨天往回数 */
function streaks(days: string[], today: string) {
  const set = new Set(days);
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const studiedToday = set.has(today);
  let current = 0;
  for (let d = studiedToday ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) current++;
  return { current, longest, studiedToday };
}

export const statsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/stats',
    { schema: { querystring: Type.Object({ from: Type.Optional(IsoDate), to: Type.Optional(IsoDate) }) } },
    async (req): Promise<StatsResponse> => {
      const { timezone: tz } = await loadSettings(app.db, req.userId);
      const today = localDate(tz);
      const to = req.query.to ?? today;
      const from = req.query.from ?? addDays(to, -29);
      if (from > to) throw new AppError('VALIDATION_FAILED', '起始日期不能晚于结束日期', [{ path: '/from', message: '晚于 to' }]);
      if (addDays(from, MAX_RANGE_DAYS) < to) throw new AppError('VALIDATION_FAILED', `统计区间最长 ${MAX_RANGE_DAYS} 天`);

      const uid = req.userId;
      const inRange = (col: string) => `(${col} AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date`;
      const p = [uid, tz, from, to];

      const [activity, minutesByDay, minutesByModule, reviewsByDay, tasksByDay, mocks] = await Promise.all([
        app.db.query(
          `SELECT DISTINCT d::text AS d FROM (
             SELECT (started_at AT TIME ZONE $2)::date AS d FROM time_logs WHERE user_id = $1 AND deleted_at IS NULL
             UNION SELECT (reviewed_at AT TIME ZONE $2)::date FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL
             UNION SELECT (completed_at AT TIME ZONE $2)::date FROM tasks
                    WHERE user_id = $1 AND deleted_at IS NULL AND status = 'done' AND completed_at IS NOT NULL
             UNION SELECT (created_at AT TIME ZONE $2)::date FROM speaking_attempts WHERE user_id = $1 AND deleted_at IS NULL
             UNION SELECT (created_at AT TIME ZONE $2)::date FROM phrase_attempts WHERE user_id = $1 AND deleted_at IS NULL
             UNION SELECT (answered_at AT TIME ZONE $2)::date FROM quiz_answers WHERE user_id = $1
             UNION SELECT (created_at AT TIME ZONE $2)::date FROM messages WHERE user_id = $1 AND role = 'user' AND deleted_at IS NULL
           ) x ORDER BY 1`,
          [uid, tz],
        ),
        app.db.query(
          `SELECT (started_at AT TIME ZONE $2)::date::text AS d, SUM(duration_ms)::bigint AS ms
             FROM time_logs WHERE user_id = $1 AND deleted_at IS NULL AND ${inRange('started_at')} GROUP BY 1`,
          p,
        ),
        app.db.query(
          `SELECT module, SUM(duration_ms)::bigint AS ms
             FROM time_logs WHERE user_id = $1 AND deleted_at IS NULL AND ${inRange('started_at')}
            GROUP BY module ORDER BY 2 DESC`,
          p,
        ),
        app.db.query(
          `SELECT (reviewed_at AT TIME ZONE $2)::date::text AS d, count(*)::int AS n,
                  count(*) FILTER (WHERE state_before = 'new')::int AS learned
             FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL AND ${inRange('reviewed_at')} GROUP BY 1`,
          p,
        ),
        app.db.query(
          `SELECT date::text AS d, count(*)::int AS n FROM tasks
            WHERE user_id = $1 AND deleted_at IS NULL AND status = 'done' AND date BETWEEN $2::date AND $3::date GROUP BY 1`,
          [uid, from, to],
        ),
        app.db.query(
          `SELECT taken_at::text AS d, level, total, total_max FROM jlpt_mocks
            WHERE user_id = $1 AND deleted_at IS NULL AND taken_at BETWEEN $2::date AND $3::date ORDER BY taken_at, created_at`,
          [uid, from, to],
        ),
      ]);

      const [mistakeTotals, quiz, convs, writing, speakTrend, writeTrend, vocabTrend, scenarioBest] = await Promise.all([
        app.db.query(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE mastered)::int AS mastered
             FROM mistakes WHERE user_id = $1 AND deleted_at IS NULL`,
          [uid],
        ),
        app.db.query(
          `SELECT count(*)::int AS answered, count(*) FILTER (WHERE NOT correct)::int AS wrong
             FROM quiz_answers WHERE user_id = $1 AND ${inRange('answered_at')}`,
          p,
        ),
        app.db.query(`SELECT count(*)::int AS n FROM conversations WHERE user_id = $1 AND deleted_at IS NULL AND ${inRange('created_at')}`, p),
        app.db.query(
          `SELECT count(*)::int AS n FROM writing_entries
            WHERE user_id = $1 AND deleted_at IS NULL AND submitted_at IS NOT NULL AND ${inRange('submitted_at')}`,
          p,
        ),
        // 朗读/跟读与句库跟读一起算：都是"开口"的分数
        app.db.query(
          `SELECT d, round(avg(o))::int AS v FROM (
             SELECT (created_at AT TIME ZONE $2)::date::text AS d, (scores->>'overall')::int AS o FROM speaking_attempts
              WHERE user_id = $1 AND deleted_at IS NULL AND method <> 'selfAssessed' AND ${inRange('created_at')}
             UNION ALL
             SELECT (created_at AT TIME ZONE $2)::date::text, (scores->>'overall')::int FROM phrase_attempts
              WHERE user_id = $1 AND deleted_at IS NULL AND method <> 'selfAssessed' AND ${inRange('created_at')}
           ) x GROUP BY d ORDER BY d`,
          p,
        ),
        app.db.query(
          `SELECT (submitted_at AT TIME ZONE $2)::date::text AS d, round(avg((correction->>'score')::int))::int AS v
             FROM writing_entries WHERE user_id = $1 AND deleted_at IS NULL AND status = 'corrected' AND ${inRange('submitted_at')}
            GROUP BY 1 ORDER BY 1`,
          p,
        ),
        // 同一天测了多次取最后一次
        app.db.query(
          `SELECT DISTINCT ON (d) d, v FROM (
             SELECT (created_at AT TIME ZONE $2)::date::text AS d, estimated_vocab AS v, created_at FROM vocab_test_results
              WHERE user_id = $1 AND deleted_at IS NULL AND ${inRange('created_at')}
           ) x ORDER BY d, created_at DESC`,
          p,
        ),
        app.db.query(
          `SELECT scenario_id, max(score)::int AS best FROM conversations
            WHERE user_id = $1 AND deleted_at IS NULL AND status = 'finished' GROUP BY scenario_id`,
          [uid],
        ),
      ]);
      const best = new Map(scenarioBest.rows.map((r) => [r.scenario_id as string, r.best as number | null]));
      const m = mistakeTotals.rows[0];
      const qz = quiz.rows[0];
      const trend = (rows: Row[]) => rows.map((r) => ({ date: r.d as string, value: r.v as number }));

      const mins = new Map(minutesByDay.rows.map((r) => [r.d as string, Number(r.ms) / 60_000]));
      const revs = new Map(reviewsByDay.rows.map((r) => [r.d as string, r]));
      const done = new Map(tasksByDay.rows.map((r) => [r.d as string, r.n as number]));

      const daily: StatsResponse['daily'] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        daily.push({ date: d, minutes: Math.round(mins.get(d) ?? 0), cardsReviewed: revs.get(d)?.n ?? 0, tasksDone: done.get(d) ?? 0 });
      }
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

      return {
        range: { from, to, timezone: tz },
        streak: streaks(activity.rows.map((r) => r.d as string), today),
        totals: {
          minutes: Math.round(sum([...mins.values()])),
          cardsReviewed: sum(reviewsByDay.rows.map((r) => r.n as number)),
          cardsLearned: sum(reviewsByDay.rows.map((r) => r.learned as number)),
          tasksDone: sum([...done.values()]),
          conversations: convs.rows[0].n,
          writingEntries: writing.rows[0].n,
        },
        moduleMinutes: minutesByModule.rows.map((r) => ({ module: r.module as StudyModule, minutes: Math.round(Number(r.ms) / 60_000) })),
        daily,
        mistakes: {
          total: m.total,
          mastered: m.mastered,
          open: m.total - m.mastered,
          quizAnswered: qz.answered,
          quizWrong: qz.wrong,
          errorRate: qz.answered ? Math.round((qz.wrong / qz.answered) * 100) / 100 : 0,
        },
        trends: {
          speakingOverall: trend(speakTrend.rows),
          writingScore: trend(writeTrend.rows),
          vocabEstimate: trend(vocabTrend.rows),
          jlptMock: mocks.rows.map((r) => ({
            date: r.d as string,
            level: r.level,
            value: Math.round(((r.total as number) / (r.total_max as number)) * 1000) / 10,
          })),
        },
        scenarioMastery: SCENARIO_CATEGORIES.map((category) => {
          const inCat = SCENARIOS.filter((sc) => sc.category === category);
          const scores = inCat.map((sc) => best.get(sc.id)).filter((v): v is number => typeof v === 'number');
          return {
            category,
            total: inCat.length,
            attempted: scores.length,
            mastered: scores.filter((v) => v >= SCENARIO_MASTERY_SCORE).length,
            avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
          };
        }),
      };
    },
  );

  /* ───────────── 学习时长 ───────────── */

  app.post(
    '/stats/time-logs',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            id: Type.Optional(Uuid),
            module: ModuleSchema,
            startedAt: IsoDateTime,
            durationMs: Type.Integer({ minimum: 1000, maximum: 14_400_000 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const id = b.id ?? uuid();
      const { rows } = await app.db.query(
        `INSERT INTO time_logs (id, user_id, module, started_at, duration_ms) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id, req.userId, b.module, b.startedAt, b.durationMs],
      );
      const row = rows[0] ?? (await getExistingOrReject(app.db, 'time_logs', req.userId, id));
      return reply.code(201).send(timeLogToApi(row));
    },
  );

  /* ───────────── JLPT 模考 ───────────── */

  const Section = Type.Object(
    { name: Type.String({ minLength: 1, maxLength: 40 }), score: Type.Integer({ minimum: 0 }), max: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  );

  app.get('/stats/jlpt-mocks', { schema: { querystring: Type.Object(PageQuery) } }, async (req) => {
    const lim = clampLimit(req.query.limit);
    const c = decodeCursor(req.query.cursor);
    const { rows } = await app.db.query(
      `SELECT * FROM jlpt_mocks WHERE user_id = $1 AND deleted_at IS NULL
          AND ($2::date IS NULL OR (taken_at, id) < ($2::date, $3::uuid))
        ORDER BY taken_at DESC, id DESC LIMIT $4`,
      [req.userId, c ? c.k[0] : null, c ? c.id : null, lim + 1],
    );
    const page = paginate(rows, lim, (r) => ({ k: [r.taken_at], id: r.id as string }));
    return { items: page.items.map(mockToApi), nextCursor: page.nextCursor };
  });

  app.post(
    '/stats/jlpt-mocks',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            id: Type.Optional(Uuid),
            level: JlptLevel,
            takenAt: IsoDate,
            sections: Type.Array(Section, { minItems: 1, maxItems: 5 }),
            source: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (b.sections.some((s) => s.score > s.max)) {
        throw new AppError('VALIDATION_FAILED', '分项得分不能超过满分', [{ path: '/sections', message: 'score > max' }]);
      }
      const id = b.id ?? uuid();
      const total = b.sections.reduce((s, x) => s + x.score, 0);
      const totalMax = b.sections.reduce((s, x) => s + x.max, 0);
      const { rows } = await app.db.query(
        `INSERT INTO jlpt_mocks (id, user_id, level, taken_at, sections, total, total_max, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id, req.userId, b.level, b.takenAt, JSON.stringify(b.sections), total, totalMax, b.source ?? null],
      );
      const row = rows[0] ?? (await getExistingOrReject(app.db, 'jlpt_mocks', req.userId, id));
      return reply.code(201).send(mockToApi(row));
    },
  );

  app.delete('/stats/jlpt-mocks/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'jlpt_mocks', req.userId, req.params.id, req.query.baseVersion, mockToApi);
    return reply.code(204).send();
  });
};
