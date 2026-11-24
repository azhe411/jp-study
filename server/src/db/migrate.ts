/**
 * 迁移执行器：按文件名顺序执行 migrations/*.sql，每个文件一个事务。
 * 已执行过的记在 schema_migrations；文件内容被改动会拒绝启动 ——
 * 历史只能追加，不能涂改。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { sha256 } from '../lib/util';

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'migrations');

export async function migrate(databaseUrl: string, log: (m: string) => void = console.log): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // 多实例同时启动时只放一个进来
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const sum = sha256(sql);
      const prev = applied.get(file);
      if (prev) {
        if (prev !== sum) throw new Error(`迁移 ${file} 已执行但内容被修改，请新建迁移文件而不是改旧的`);
        continue;
      }
      log(`applying migration ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, sum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`迁移 ${file} 失败：${(e as Error).message}`);
      }
    }
    log(`migrations up to date (${files.length} files)`);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('缺少 DATABASE_URL');
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
