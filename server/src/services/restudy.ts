/**
 * 重新学习的公共查询（契约 v1.10.0）。
 *
 * "还没记牢的卡"：选过重来（新卡第一次就选重来也算，不看 lapses），而且最后一次重来之后还没证明记住 ——
 * 证明的办法是重学时第一次就记住，或者隔了至少一天复习评良好以上。这样做完就会从名单上下来。
 */
import type { Queryable } from '../db/pool';

/** 用法：FROM cards c WHERE c.user_id = $1 AND ${HARD_CARD} */
export const HARD_CARD = `c.deleted_at IS NULL AND NOT c.suspended AND EXISTS (
    SELECT 1 FROM review_logs x WHERE x.card_id = c.id AND x.deleted_at IS NULL AND x.rating = 1
  ) AND NOT EXISTS (
    SELECT 1 FROM restudy_results r
     WHERE r.user_id = c.user_id AND r.card_id = c.id AND r.known
       AND r.created_at > COALESCE((SELECT max(a.reviewed_at) FROM review_logs a WHERE a.card_id = c.id AND a.deleted_at IS NULL AND a.rating = 1), 'epoch')
  ) AND NOT EXISTS (
    SELECT 1 FROM review_logs g
     WHERE g.card_id = c.id AND g.deleted_at IS NULL AND g.rating >= 3
       AND g.reviewed_at > COALESCE((SELECT max(a.reviewed_at) FROM review_logs a WHERE a.card_id = c.id AND a.deleted_at IS NULL AND a.rating = 1), 'epoch') + interval '1 day'
  )`;

export async function hardCount(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM cards c WHERE c.user_id = $1 AND ${HARD_CARD}`, [userId]);
  return rows[0].n as number;
}
