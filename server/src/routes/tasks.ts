/**
 * 今日任务、周计划与任务模板。
 * "今天"永远按用户设置里的时区来算 —— 服务器在香港，人在哪里，日子就在哪里。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { DayMode } from '../../../shared/constants';
import type { Task, TaskTemplate, TodayResponse } from '../../../shared/types';
import { getOwned, softDelete, updateVersioned, withTx, type Queryable } from '../db/pool';
import { AppError } from '../lib/errors';
import { camelRow, clampLimit, decodeCursor, localDate, paginate, uuid, weekdayOf } from '../lib/util';
import {
  DayMode as DayModeSchema,
  DeleteQuery,
  IdParams,
  IsoDate,
  PageQuery,
  StudyModule,
  TaskFields,
  TaskStatus,
  TemplateFields,
  Uuid,
  VersionedMeta,
  WriteMeta,
  partial,
} from '../schemas';
import { loadSettings } from '../services/settings';

type Row = Record<string, unknown>;

export const taskToApi = (row: Row) => camelRow<Task>(row);
export const templateToApi = (row: Row) => camelRow<TaskTemplate>(row);

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** 请求体里出现的白名单字段 → { snake_column: value } */
export function pickSets(body: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) out[snake(k)] = body[k];
  return out;
}

/** 按档位把启用中的模板铺成当天任务；已由同一模板生成过的不重复铺 */
async function materialize(q: Queryable, userId: string, date: string, mode: DayMode): Promise<number> {
  const weekday = weekdayOf(date);
  const { rowCount } = await q.query(
    `INSERT INTO tasks (id, user_id, date, title, module, target_minutes, target_count, template_id, sort_order, link)
     SELECT gen_random_uuid(), t.user_id, $2::date, t.title, t.module, t.target_minutes, t.target_count, t.id, t.sort_order, t.link
       FROM task_templates t
      WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.active
        AND $3 = ANY (t.day_modes)
        AND (cardinality(t.weekdays) = 0 OR $4 = ANY (t.weekdays))
        AND NOT EXISTS (SELECT 1 FROM tasks x
                         WHERE x.user_id = t.user_id AND x.date = $2::date AND x.template_id = t.id AND x.deleted_at IS NULL)`,
    [userId, date, mode, weekday],
  );
  return rowCount ?? 0;
}

async function buildToday(q: Queryable, userId: string, date: string, mode: DayMode, generated: boolean): Promise<TodayResponse> {
  const settings = await loadSettings(q, userId);
  const [tasks, studied, due] = await Promise.all([
    q.query('SELECT * FROM tasks WHERE user_id = $1 AND date = $2 AND deleted_at IS NULL ORDER BY sort_order, created_at, id', [
      userId,
      date,
    ]),
    q.query(
      `SELECT COALESCE(SUM(duration_ms), 0) AS ms FROM time_logs
        WHERE user_id = $1 AND deleted_at IS NULL AND (started_at AT TIME ZONE $3)::date = $2::date`,
      [userId, date, settings.timezone],
    ),
    q.query(
      `SELECT count(*)::int AS n FROM cards
        WHERE user_id = $1 AND deleted_at IS NULL AND NOT suspended AND state <> 'new' AND due <= now()`,
      [userId],
    ),
  ]);
  const items = tasks.rows.map(taskToApi);
  return {
    date,
    dayMode: mode,
    generated,
    tasks: items,
    summary: {
      total: items.length,
      done: items.filter((t) => t.status === 'done').length,
      plannedMinutes: items.reduce((s, t) => s + (t.targetMinutes ?? 0), 0),
      studiedMinutes: Math.round(Number(studied.rows[0].ms) / 60_000),
      dueCards: due.rows[0].n,
    },
  };
}

export const taskRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /* ───────────── 今天 ───────────── */

  app.get('/tasks/today', { schema: { querystring: Type.Object({ date: Type.Optional(IsoDate) }) } }, async (req) => {
    const settings = await loadSettings(app.db, req.userId);
    const date = req.query.date ?? localDate(settings.timezone);
    return withTx(app.db, async (tx) => {
      const mode = settings.weekPlan[weekdayOf(date)];
      const ins = await tx.query(
        'INSERT INTO day_plans (user_id, date, day_mode) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING day_mode',
        [req.userId, date, mode],
      );
      if (ins.rows[0]) {
        await materialize(tx, req.userId, date, mode);
        return buildToday(tx, req.userId, date, mode, true);
      }
      const { rows } = await tx.query('SELECT day_mode FROM day_plans WHERE user_id = $1 AND date = $2', [req.userId, date]);
      return buildToday(tx, req.userId, date, rows[0].day_mode as DayMode, false);
    });
  });

  app.post(
    '/tasks/generate',
    {
      schema: {
        body: Type.Object(
          { ...WriteMeta, date: IsoDate, dayMode: DayModeSchema, regenerate: Type.Optional(Type.Boolean()) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      const { date, dayMode, regenerate } = req.body;
      return withTx(app.db, async (tx) => {
        await tx.query(
          `INSERT INTO day_plans (user_id, date, day_mode) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, date) DO UPDATE SET day_mode = EXCLUDED.day_mode, version = day_plans.version + 1
           WHERE day_plans.day_mode IS DISTINCT FROM EXCLUDED.day_mode`,
          [req.userId, date, dayMode],
        );
        if (regenerate) {
          await tx.query(
            `UPDATE tasks SET deleted_at = now(), version = version + 1
              WHERE user_id = $1 AND date = $2 AND template_id IS NOT NULL AND status = 'todo' AND deleted_at IS NULL`,
            [req.userId, date],
          );
        }
        await materialize(tx, req.userId, date, dayMode);
        return buildToday(tx, req.userId, date, dayMode, true);
      });
    },
  );

  /* ───────────── 任务 CRUD ───────────── */

  app.get(
    '/tasks',
    {
      schema: {
        querystring: Type.Object({
          from: Type.Optional(IsoDate),
          to: Type.Optional(IsoDate),
          status: Type.Optional(TaskStatus),
          module: Type.Optional(StudyModule),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      const { from, to, status, module, cursor, limit } = req.query;
      const lim = clampLimit(limit);
      const c = decodeCursor(cursor);
      const params: unknown[] = [req.userId];
      const where = ['user_id = $1', 'deleted_at IS NULL'];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (from) add('date >= ?', from);
      if (to) add('date <= ?', to);
      if (status) add('status = ?', status);
      if (module) add('module = ?', module);
      if (c) {
        params.push(c.k[0], c.k[1], c.id);
        const n = params.length;
        where.push(`(date, sort_order, id) > ($${n - 2}::date, $${n - 1}::int, $${n}::uuid)`);
      }
      params.push(lim + 1);
      const { rows } = await app.db.query(
        `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY date, sort_order, id LIMIT $${params.length}`,
        params,
      );
      const page = paginate(rows, lim, (r) => ({ k: [r.date, r.sort_order], id: r.id as string }));
      return { items: page.items.map(taskToApi), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/tasks',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            id: Type.Optional(Uuid),
            date: TaskFields.date,
            title: TaskFields.title,
            module: TaskFields.module,
            targetMinutes: Type.Optional(TaskFields.targetMinutes),
            targetCount: Type.Optional(TaskFields.targetCount),
            sortOrder: Type.Optional(TaskFields.sortOrder),
            link: Type.Optional(TaskFields.link),
            note: Type.Optional(TaskFields.note),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const id = b.id ?? uuid();
      const { rows } = await app.db.query(
        `INSERT INTO tasks (id, user_id, date, title, module, target_minutes, target_count, sort_order, link, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 COALESCE($8, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM tasks WHERE user_id = $2 AND date = $3)),
                 $9, $10)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id, req.userId, b.date, b.title, b.module, b.targetMinutes ?? null, b.targetCount ?? null, b.sortOrder ?? null, b.link ?? null, b.note ?? null],
      );
      // id 已存在：同一用户视为重复创建，返回已有记录
      const row = rows[0] ?? (await getExistingOrReject(app.db, 'tasks', req.userId, id));
      return reply.code(201).send(taskToApi(row));
    },
  );

  app.patch(
    '/tasks/:id',
    {
      schema: {
        params: IdParams,
        body: Type.Object({ ...VersionedMeta, ...partial({ ...TaskFields, status: TaskStatus }) }, { additionalProperties: false }),
      },
    },
    async (req) => {
      const sets = pickSets(req.body, ['title', 'module', 'date', 'targetMinutes', 'targetCount', 'status', 'sortOrder', 'link', 'note']);
      if (req.body.status !== undefined) sets.completed_at = req.body.status === 'done' ? new Date() : null;
      const row = await updateVersioned(app.db, 'tasks', req.userId, req.params.id, req.body.baseVersion, sets, taskToApi);
      return taskToApi(row);
    },
  );

  app.delete('/tasks/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'tasks', req.userId, req.params.id, req.query.baseVersion, taskToApi);
    return reply.code(204).send();
  });

  /* ───────────── 模板 CRUD ───────────── */

  app.get('/task-templates', { schema: { querystring: Type.Object(PageQuery) } }, async (req) => {
    const lim = clampLimit(req.query.limit);
    const c = decodeCursor(req.query.cursor);
    const { rows } = await app.db.query(
      `SELECT * FROM task_templates
        WHERE user_id = $1 AND deleted_at IS NULL
          AND ($2::int IS NULL OR (sort_order, id) > ($2::int, $3::uuid))
        ORDER BY sort_order, id LIMIT $4`,
      [req.userId, c ? c.k[0] : null, c ? c.id : null, lim + 1],
    );
    const page = paginate(rows, lim, (r) => ({ k: [r.sort_order], id: r.id as string }));
    return { items: page.items.map(templateToApi), nextCursor: page.nextCursor };
  });

  app.get('/task-templates/:id', { schema: { params: IdParams } }, async (req) =>
    templateToApi(await getOwned(app.db, 'task_templates', req.userId, req.params.id)),
  );

  app.post(
    '/task-templates',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            id: Type.Optional(Uuid),
            title: TemplateFields.title,
            module: TemplateFields.module,
            dayModes: TemplateFields.dayModes,
            ...partial({
              weekdays: TemplateFields.weekdays,
              targetMinutes: TemplateFields.targetMinutes,
              targetCount: TemplateFields.targetCount,
              sortOrder: TemplateFields.sortOrder,
              active: TemplateFields.active,
              link: TemplateFields.link,
            }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const id = b.id ?? uuid();
      const { rows } = await app.db.query(
        `INSERT INTO task_templates (id, user_id, title, module, day_modes, weekdays, target_minutes, target_count, sort_order, active, link)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 COALESCE($9, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM task_templates WHERE user_id = $2)),
                 $10, $11)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id, req.userId, b.title, b.module, b.dayModes, b.weekdays ?? [], b.targetMinutes ?? null, b.targetCount ?? null, b.sortOrder ?? null, b.active ?? true, b.link ?? null],
      );
      const row = rows[0] ?? (await getExistingOrReject(app.db, 'task_templates', req.userId, id));
      return reply.code(201).send(templateToApi(row));
    },
  );

  app.patch(
    '/task-templates/:id',
    { schema: { params: IdParams, body: Type.Object({ ...VersionedMeta, ...partial(TemplateFields) }, { additionalProperties: false }) } },
    async (req) => {
      const sets = pickSets(req.body, ['title', 'module', 'dayModes', 'weekdays', 'targetMinutes', 'targetCount', 'sortOrder', 'active', 'link']);
      const row = await updateVersioned(app.db, 'task_templates', req.userId, req.params.id, req.body.baseVersion, sets, templateToApi);
      return templateToApi(row);
    },
  );

  app.delete('/task-templates/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'task_templates', req.userId, req.params.id, req.query.baseVersion, templateToApi);
    return reply.code(204).send();
  });
};

/** 客户端自带 id 撞上已有记录：本人的就原样返回，别人的一律拒绝 */
export async function getExistingOrReject(q: Queryable, table: string, userId: string, id: string): Promise<Row> {
  const { rows } = await q.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (rows[0] && rows[0].user_id === userId) return rows[0];
  throw new AppError('UNPROCESSABLE', 'id 已被占用');
}
