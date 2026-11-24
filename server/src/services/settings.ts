import type { Settings, SettingsData } from '../../../shared/types';
import type { Queryable } from '../db/pool';
import { camelRow, uuid } from '../lib/util';
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } from './defaults';

type Row = Record<string, unknown>;

export const settingsToApi = (row: Row) => camelRow<Settings>(row);

/** 读设置；首次访问时以默认值落库。旧数据缺失的新字段用默认值补齐 */
export async function loadSettingsRow(q: Queryable, userId: string): Promise<Row> {
  const found = await q.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
  if (found.rows[0]) {
    const row = found.rows[0];
    row.data = { ...DEFAULT_SETTINGS, ...(row.data as SettingsData) };
    return row;
  }
  const { rows } = await q.query(
    `INSERT INTO settings (id, user_id, data) VALUES ($1, $1, $2)
     ON CONFLICT (user_id) DO UPDATE SET data = settings.data
     RETURNING *`,
    [userId, JSON.stringify(DEFAULT_SETTINGS)],
  );
  return rows[0];
}

export async function loadSettings(q: Queryable, userId: string): Promise<SettingsData> {
  return (await loadSettingsRow(q, userId)).data as SettingsData;
}

/** 新用户入住：设置 + 起步模板 */
export async function seedNewUser(q: Queryable, userId: string): Promise<void> {
  await loadSettingsRow(q, userId);
  let order = 0;
  for (const t of DEFAULT_TEMPLATES) {
    await q.query(
      `INSERT INTO task_templates (id, user_id, title, module, day_modes, target_minutes, target_count, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuid(), userId, t.title, t.module, t.dayModes, t.targetMinutes, t.targetCount, (order += 10)],
    );
  }
}
