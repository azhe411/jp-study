/**
 * 练习记录类（只追加）实体的公共写法：
 *   insertOnce   —— 按 id 幂等插入；同一用户重推返回原记录，id 被别人占用则 422
 *   pageByCreated —— 按创建时间倒序的游标分页，附带若干等值过滤
 * 表名与列名只来自代码里的常量，不拼接用户输入。
 */
import { getExistingOrReject } from '../routes/tasks';
import { clampLimit, decodeCursor, paginate } from '../lib/util';
import type { Queryable } from './pool';

type Row = Record<string, unknown>;

export async function insertOnce(q: Queryable, table: string, userId: string, values: Row): Promise<{ row: Row; created: boolean }> {
  const cols = ['user_id', ...Object.keys(values)];
  const params = [userId, ...Object.values(values)];
  const { rows } = await q.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    params,
  );
  if (rows[0]) return { row: rows[0], created: true };
  return { row: await getExistingOrReject(q, table, userId, values.id as string), created: false };
}

export async function pageByCreated<T>(
  q: Queryable,
  table: string,
  userId: string,
  filters: Record<string, unknown>,
  query: { cursor?: string; limit?: number },
  toApi: (row: Row) => T,
): Promise<{ items: T[]; nextCursor: string | null }> {
  const lim = clampLimit(query.limit);
  const c = decodeCursor(query.cursor);
  const params: unknown[] = [userId];
  const where = ['user_id = $1', 'deleted_at IS NULL'];
  for (const [col, v] of Object.entries(filters)) {
    if (v === undefined || v === null) continue;
    params.push(v);
    where.push(`${col} = $${params.length}`);
  }
  if (c) {
    params.push(c.k[0], c.id);
    where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(lim + 1);
  const { rows } = await q.query(
    `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const page = paginate(rows, lim, (r) => ({ k: [(r.created_at as Date).toISOString()], id: r.id as string }));
  return { items: page.items.map(toApi), nextCursor: page.nextCursor };
}
