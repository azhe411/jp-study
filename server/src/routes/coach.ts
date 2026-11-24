/**
 * 学习教练（契约 v1.5.0 §20）。
 *   GET  /coach/live               主页的实时点评（v1.7.0）：学习记录一变就更新，从不让页面等 AI
 *   GET  /coach/daily              今天的小结（没有就现写）
 *   GET  /coach/weekly             本周回顾
 *   GET  /coach/lessons/:lessonId  某一课的小结（考过小测才有）
 *   GET  /coach/notes              最近的小结，新的在前
 *   POST /coach/notes/:id/read     标为已读
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { CoachNote } from '../../../shared/types';
import { LESSON_BY_ID } from '../content/curriculum';
import { AppError, notFound } from '../lib/errors';
import { localDate } from '../lib/util';
import { IdParams, WriteMeta } from '../schemas';
import { coachNote, coachToApi, liveNote, mondayOf } from '../services/coach';
import { loadSettings } from '../services/settings';

export const coachRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const rate = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.get('/coach/live', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req): Promise<CoachNote> => liveNote(app, req.userId));

  app.get('/coach/daily', { config: rate }, async (req): Promise<CoachNote> => {
    const { timezone } = await loadSettings(app.db, req.userId);
    return coachNote(app, req.userId, 'daily', localDate(timezone));
  });

  app.get('/coach/weekly', { config: rate }, async (req): Promise<CoachNote> => {
    const { timezone } = await loadSettings(app.db, req.userId);
    return coachNote(app, req.userId, 'weekly', mondayOf(localDate(timezone)));
  });

  app.get('/coach/lessons/:lessonId', { config: rate, schema: { params: Type.Object({ lessonId: Type.String({ maxLength: 40 }) }) } }, async (req): Promise<CoachNote> => {
    if (!LESSON_BY_ID.has(req.params.lessonId)) throw notFound('这一课不存在');
    const tried = await app.db.query('SELECT 1 FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2 AND attempts > 0', [req.userId, req.params.lessonId]);
    if (!tried.rows[0]) throw new AppError('UNPROCESSABLE', '考过这一课的小测之后才有小结');
    return coachNote(app, req.userId, 'lesson', req.params.lessonId);
  });

  app.get('/coach/notes', { schema: { querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }) } }, async (req) => {
    const { rows } = await app.db.query('SELECT * FROM coach_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [req.userId, req.query.limit ?? 20]);
    return { items: rows.map((r) => coachToApi(r)) };
  });

  app.post('/coach/notes/:id/read', { schema: { params: IdParams, body: Type.Object(WriteMeta, { additionalProperties: false }) } }, async (req): Promise<CoachNote> => {
    const { rows } = await app.db.query('UPDATE coach_notes SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *', [req.params.id, req.userId]);
    if (!rows[0]) throw notFound('找不到这份小结');
    return coachToApi(rows[0]);
  });
};
