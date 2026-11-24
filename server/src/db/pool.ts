import pg from 'pg';
import { AppError, notFound, versionConflict } from '../lib/errors';

// date 列按原样返回 "YYYY-MM-DD"，免得被 JS Date 偷偷挪进本地时区
pg.types.setTypeParser(1082, (v) => v);
// bigint（rev）在本项目量级内安全落在 Number 范围
pg.types.setTypeParser(20, (v) => Number(v));
// numeric（stability 等）转为 number
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

/** 事务包装：成功提交，失败回滚，连接总会归还 */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

type Row = Record<string, unknown>;

/**
 * 带乐观锁的更新。
 * sets: { column: value }；baseVersion 缺省时后写覆盖。
 * 找不到 → 404；版本不符 → 409（附服务端当前记录）。
 */
export async function updateVersioned(
  q: Queryable,
  table: string,
  userId: string,
  id: string,
  baseVersion: number | undefined,
  sets: Record<string, unknown>,
  toApi: (row: Row) => unknown,
): Promise<Row> {
  const cols = Object.keys(sets);
  if (cols.length === 0) throw new AppError('VALIDATION_FAILED', '没有需要修改的字段');
  const assign = cols.map((c, i) => `${c} = $${i + 4}`).join(', ');
  const { rows } = await q.query(
    `UPDATE ${table} SET ${assign}, version = version + 1
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        AND ($3::int IS NULL OR version = $3)
      RETURNING *`,
    [id, userId, baseVersion ?? null, ...cols.map((c) => sets[c])],
  );
  if (rows[0]) return rows[0];
  return raiseMissingOrConflict(q, table, userId, id, toApi);
}

/** 软删除；已删除视为成功（DELETE 天然幂等） */
export async function softDelete(
  q: Queryable,
  table: string,
  userId: string,
  id: string,
  baseVersion: number | undefined,
  toApi: (row: Row) => unknown,
): Promise<void> {
  const { rowCount } = await q.query(
    `UPDATE ${table} SET deleted_at = now(), version = version + 1
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        AND ($3::int IS NULL OR version = $3)`,
    [id, userId, baseVersion ?? null],
  );
  if (rowCount) return;
  const { rows } = await q.query(`SELECT deleted_at FROM ${table} WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (rows[0]?.deleted_at) return;
  await raiseMissingOrConflict(q, table, userId, id, toApi);
}

async function raiseMissingOrConflict(
  q: Queryable,
  table: string,
  userId: string,
  id: string,
  toApi: (row: Row) => unknown,
): Promise<never> {
  const { rows } = await q.query(`SELECT * FROM ${table} WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [
    id,
    userId,
  ]);
  if (!rows[0]) throw notFound();
  throw versionConflict(rows[0].version, toApi(rows[0]));
}

/** 取单条（默认过滤软删除），不存在即 404 */
export async function getOwned(q: Queryable, table: string, userId: string, id: string): Promise<Row> {
  const { rows } = await q.query(`SELECT * FROM ${table} WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [
    id,
    userId,
  ]);
  if (!rows[0]) throw notFound();
  return rows[0];
}
