/**
 * 视频课程（契约 §15）：B 站多 P 合集按"入门 / 初级 / 中级"分组，每集标注对应的课程站与观看进度。
 * 播放用 B 站官方外链播放器；位置是客户端的估算值，同一集取较大者，看完标记不回退。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { VideoCourse, VideoCourseSummary, VideoEpisode, VideoProgress } from '../../../shared/types';
import BILI from '../content/biliAfei.json';
import { BILI_COURSE_ID, LESSON_OF_PAGE } from '../content/curriculum';
import { notFound } from '../lib/errors';
import { camelRow, uuid } from '../lib/util';
import { WriteMeta } from '../schemas';

type Row = Record<string, unknown>;

export const videoProgressToApi = (r: Row) => camelRow<VideoProgress>(r);

function sectionOf(title: string, page: number): string {
  if (/^中级/.test(title)) return '中级';
  if (/^第\d+课/.test(title)) return Number(title.match(/^第(\d+)课/)![1]) <= 24 ? '初级上' : '初级下';
  if (page <= 9) return '入门';
  return '其他';
}

async function summary(q: { query: (t: string, v: unknown[]) => Promise<{ rows: Row[] }> }, userId: string): Promise<VideoCourseSummary> {
  const { rows } = await q.query(
    `SELECT (SELECT page FROM video_progress WHERE user_id = $1 AND course_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1) AS last_page,
            (SELECT count(*)::int FROM video_progress WHERE user_id = $1 AND course_id = $2 AND completed AND deleted_at IS NULL) AS completed`,
    [userId, BILI_COURSE_ID],
  );
  return {
    id: BILI_COURSE_ID,
    title: '新标日 0 基础到中级（阿飞老师）',
    author: BILI.author,
    platform: 'bilibili',
    bvid: BILI.bvid,
    episodeCount: BILI.pages.length,
    totalMinutes: Math.round(BILI.pages.reduce((s, p) => s + p.durationSec, 0) / 60),
    lastPage: (rows[0].last_page as number | null) ?? null,
    completedCount: rows[0].completed as number,
  };
}

export const videoRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/video-courses', async (req) => ({ items: [await summary(app.db, req.userId)] }));

  app.get('/video-courses/:courseId', { schema: { params: Type.Object({ courseId: Type.String({ maxLength: 60 }) }) } }, async (req): Promise<VideoCourse> => {
    if (req.params.courseId !== BILI_COURSE_ID) throw notFound('视频课程不存在');
    const { rows } = await app.db.query('SELECT * FROM video_progress WHERE user_id = $1 AND course_id = $2 AND deleted_at IS NULL', [req.userId, BILI_COURSE_ID]);
    const prog = new Map(rows.map((r) => [r.page as number, r]));
    const episodes: VideoEpisode[] = BILI.pages.map((p) => {
      const r = prog.get(p.page);
      return {
        page: p.page,
        title: p.title,
        section: sectionOf(p.title, p.page),
        durationSec: p.durationSec,
        lessonId: LESSON_OF_PAGE.get(p.page) ?? null,
        progress: r ? { positionSec: r.position_sec as number, completed: r.completed as boolean, updatedAt: (r.updated_at as Date).toISOString() } : null,
      };
    });
    return { ...(await summary(app.db, req.userId)), episodes };
  });

  app.put(
    '/video-progress/:courseId/:page',
    {
      schema: {
        params: Type.Object({ courseId: Type.String({ maxLength: 60 }), page: Type.Integer({ minimum: 1 }) }),
        body: Type.Object({ ...WriteMeta, positionSec: Type.Integer({ minimum: 0, maximum: 36_000 }), completed: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      },
    },
    async (req) => {
      const meta = req.params.courseId === BILI_COURSE_ID ? BILI.pages.find((p) => p.page === req.params.page) : undefined;
      if (!meta) throw notFound('这一集不存在');
      const pos = Math.min(req.body.positionSec, meta.durationSec);
      const { rows } = await app.db.query(
        `INSERT INTO video_progress (id, user_id, course_id, page, position_sec, duration_sec, completed)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, false))
         ON CONFLICT (user_id, course_id, page) DO UPDATE SET
           position_sec = GREATEST(video_progress.position_sec, EXCLUDED.position_sec),
           completed = COALESCE($7, video_progress.completed),
           deleted_at = NULL,
           version = video_progress.version + 1
         RETURNING *`,
        [uuid(), req.userId, BILI_COURSE_ID, meta.page, pos, meta.durationSec, req.body.completed ?? null],
      );
      return videoProgressToApi(rows[0]);
    },
  );
};
