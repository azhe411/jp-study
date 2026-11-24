/**
 * 内置内容按用户补种。用 user_seeds 记下已种到哪个版本：
 * 版本落后才插入，且只插缺的（ON CONFLICT 跳过），绝不覆盖用户改过的备注、收藏和练习记录。
 */
import { BUILTIN_PHRASES, PHRASE_SEED_VERSION } from '../content/phrases';
import { withTx, type Db } from '../db/pool';

export async function ensurePhraseSeed(db: Db, userId: string): Promise<void> {
  const { rows } = await db.query(`SELECT version FROM user_seeds WHERE user_id = $1 AND kind = 'phrases'`, [userId]);
  if ((rows[0]?.version ?? 0) >= PHRASE_SEED_VERSION) return;

  await withTx(db, async (tx) => {
    // 同一用户并发打开句库时只让一个请求去种
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('seed:phrases:' || $1))`, [userId]);
    const again = await tx.query(`SELECT version FROM user_seeds WHERE user_id = $1 AND kind = 'phrases'`, [userId]);
    if ((again.rows[0]?.version ?? 0) >= PHRASE_SEED_VERSION) return;

    await tx.query(
      `INSERT INTO phrases (id, user_id, book, category, ja, reading, zh, builtin, slug, sort_key)
       SELECT gen_random_uuid(), $1, p.book, p.category, p.ja, p.reading, p.zh, true, p.slug, p.ord
         FROM jsonb_to_recordset($2::jsonb) AS p(book text, category text, ja text, reading text, zh text, slug text, ord bigint)
       ON CONFLICT (user_id, slug) WHERE slug IS NOT NULL DO NOTHING`,
      [userId, JSON.stringify(BUILTIN_PHRASES.map((p, ord) => ({ ...p, ord })))],
    );
    await tx.query(
      `INSERT INTO user_seeds (user_id, kind, version) VALUES ($1, 'phrases', $2)
       ON CONFLICT (user_id, kind) DO UPDATE SET version = EXCLUDED.version`,
      [userId, PHRASE_SEED_VERSION],
    );
  });
}
