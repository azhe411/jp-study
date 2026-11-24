/**
 * 课程：只存外链与进度，不嵌入视频（契约 §9）。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { COURSE_PLATFORMS, COURSE_STATUSES } from '../../../shared/constants';
import type { Course } from '../../../shared/types';
import { softDelete, updateVersioned } from '../db/pool';
import { insertOnce, pageByCreated } from '../db/records';
import { camelRow, uuid } from '../lib/util';
import { DeleteQuery, IdParams, IsoDateTime, Lit, Nullable, PageQuery, Url, Uuid, VersionedMeta, WriteMeta, partial } from '../schemas';
import { pickSets } from './tasks';

type Row = Record<string, unknown>;

export const courseToApi = (row: Row) => camelRow<Course>(row);

const CourseFields = {
  title: Type.String({ minLength: 1, maxLength: 120 }),
  platform: Lit(COURSE_PLATFORMS),
  url: Url,
  totalEpisodes: Nullable(Type.Integer({ minimum: 1, maximum: 100_000 })),
  currentEpisode: Type.Integer({ minimum: 0, maximum: 100_000 }),
  status: Lit(COURSE_STATUSES),
  note: Nullable(Type.String({ maxLength: 1000 })),
};

export const courseRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/courses', { schema: { querystring: Type.Object({ status: Type.Optional(Lit(COURSE_STATUSES)), ...PageQuery }) } }, async (req) =>
    pageByCreated(app.db, 'courses', req.userId, { status: req.query.status }, req.query, courseToApi),
  );

  app.post(
    '/courses',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            id: Type.Optional(Uuid),
            title: CourseFields.title,
            platform: CourseFields.platform,
            url: CourseFields.url,
            totalEpisodes: Type.Optional(CourseFields.totalEpisodes),
            currentEpisode: Type.Optional(CourseFields.currentEpisode),
            status: Type.Optional(CourseFields.status),
            note: Type.Optional(CourseFields.note),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const { row } = await insertOnce(app.db, 'courses', req.userId, {
        id: b.id ?? uuid(),
        title: b.title.trim(),
        platform: b.platform,
        url: b.url,
        total_episodes: b.totalEpisodes ?? null,
        current_episode: b.currentEpisode ?? 0,
        status: b.status ?? 'planned',
        note: b.note ?? null,
      });
      return reply.code(201).send(courseToApi(row));
    },
  );

  app.patch(
    '/courses/:id',
    {
      schema: {
        params: IdParams,
        body: Type.Object({ ...VersionedMeta, ...partial(CourseFields), lastStudiedAt: Type.Optional(Nullable(IsoDateTime)) }, {
          additionalProperties: false,
          minProperties: 2,
        }),
      },
    },
    async (req) => {
      const sets = pickSets(req.body, ['title', 'platform', 'url', 'totalEpisodes', 'currentEpisode', 'status', 'note', 'lastStudiedAt']);
      return courseToApi(await updateVersioned(app.db, 'courses', req.userId, req.params.id, req.body.baseVersion, sets, courseToApi));
    },
  );

  app.delete('/courses/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'courses', req.userId, req.params.id, req.query.baseVersion, courseToApi);
    return reply.code(204).send();
  });
};
