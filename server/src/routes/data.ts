/**
 * 导出 / 导入 / 备份状态。
 *
 * 导出：每个可同步实体的全部行（含软删除），按列原样转 camelCase —— 导入时能无损还原。
 * 导入：merge  = 按 id 合并，只有导入方 version 更新时才覆盖；
 *       replace = 先软删除现有数据（设置与内置句除外），再按导入内容覆盖。
 * 整个导入在一个事务里，每条记录一个 savepoint：单条坏数据只会被计为 skipped，不拖垮整批。
 */
import { readFile } from 'node:fs/promises';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { EXPORT_FORMAT_VERSION, IMPORT_MODES, SYNC_ENTITIES, type ImportMode, type SyncEntity } from '../../../shared/constants';
import type { BackupStatus, ExportBundle, ImportDataResult } from '../../../shared/types';
import { withTx, type Queryable } from '../db/pool';
import { AppError } from '../lib/errors';
import { camelRow } from '../lib/util';
import { Lit, WriteMeta } from '../schemas';
import { ENTITIES, ENTITY_BY_NAME } from '../services/entities';

type Row = Record<string, unknown>;

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** 各表的列（导入时只认这些列，未知字段直接丢弃） */
const columnCache = new Map<string, string[]>();
async function columnsOf(q: Queryable, table: string): Promise<string[]> {
  const hit = columnCache.get(table);
  if (hit) return hit;
  const { rows } = await q.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  const cols = rows.map((r) => r.column_name as string);
  columnCache.set(table, cols);
  return cols;
}

export const dataRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/data/export', async (req, reply): Promise<ExportBundle> => {
    const { rows: users } = await app.db.query('SELECT id, email, display_name, created_at FROM users WHERE id = $1', [req.userId]);
    const entities: ExportBundle['entities'] = {};
    for (const e of ENTITIES) {
      const { rows } = await app.db.query(`SELECT * FROM ${e.table} WHERE user_id = $1 ORDER BY created_at, id`, [req.userId]);
      entities[e.entity] = rows.map((r) => camelRow(r));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('content-disposition', `attachment; filename="jp-study-${stamp}.json"`);
    return { formatVersion: EXPORT_FORMAT_VERSION, exportedAt: new Date().toISOString(), user: camelRow(users[0]) as never, entities };
  });

  app.post(
    '/data/import',
    {
      bodyLimit: 20 * 1024 * 1024,
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            mode: Lit(IMPORT_MODES),
            bundle: Type.Object({
              formatVersion: Type.Integer(),
              exportedAt: Type.String(),
              user: Type.Record(Type.String(), Type.Unknown()),
              entities: Type.Record(Type.String(), Type.Array(Type.Record(Type.String(), Type.Unknown()))),
            }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<ImportDataResult> => {
      const { mode, bundle } = req.body as unknown as { mode: ImportMode; bundle: ExportBundle };
      if (bundle.formatVersion !== EXPORT_FORMAT_VERSION) {
        throw new AppError('VALIDATION_FAILED', `不支持的导出格式版本 ${bundle.formatVersion}`, [{ path: '/bundle/formatVersion', message: `应为 ${EXPORT_FORMAT_VERSION}` }]);
      }
      const unknown = Object.keys(bundle.entities).filter((k) => !(SYNC_ENTITIES as readonly string[]).includes(k));
      if (unknown.length) throw new AppError('VALIDATION_FAILED', `未知的实体：${unknown.join('、')}`);
      const uid = req.userId;

      return withTx(app.db, async (tx) => {
        if (mode === 'replace') {
          for (const e of ENTITIES) {
            if (e.entity === 'settings') continue;
            await tx.query(
              `UPDATE ${e.table} SET deleted_at = now(), version = version + 1
                WHERE user_id = $1 AND deleted_at IS NULL ${e.entity === 'phrase' ? 'AND NOT builtin' : ''}`,
              [uid],
            );
          }
        }

        const counts: ImportDataResult['counts'] = {};
        for (const e of ENTITIES) {
          const records = (bundle.entities as Partial<Record<SyncEntity, Row[]>>)[e.entity];
          if (!records?.length) continue;
          const c = { created: 0, updated: 0, skipped: 0 };
          const tableCols = await columnsOf(tx, e.table);
          const conflict = ENTITY_BY_NAME.get(e.entity)?.conflict ?? '(id)';
          const keyCols = conflict.replace(/[()\s]/g, '').split(',');

          for (const rec of records) {
            const obj: Row = {};
            for (const [k, v] of Object.entries(rec)) {
              const col = snake(k);
              if (tableCols.includes(col) && col !== 'user_id' && col !== 'rev') obj[col] = v;
            }
            obj.user_id = uid;
            if (e.entity === 'settings') obj.id = uid;
            if (!obj.id) {
              c.skipped++;
              continue;
            }
            const cols = Object.keys(obj);
            const updatable = cols.filter((col) => !keyCols.includes(col) && col !== 'id' && col !== 'user_id');
            // merge 只接受更新的版本；replace 一律覆盖。两种情况都不允许覆盖别人的行
            const guard = mode === 'merge' ? `AND ${e.table}.version < EXCLUDED.version` : '';
            const sql = `INSERT INTO ${e.table} (${cols.join(', ')})
                         SELECT ${cols.join(', ')} FROM jsonb_populate_record(NULL::${e.table}, $1::jsonb)
                         ON CONFLICT ${conflict} DO UPDATE SET ${updatable.map((col) => `${col} = EXCLUDED.${col}`).join(', ') || 'id = EXCLUDED.id'}
                         WHERE ${e.table}.user_id = EXCLUDED.user_id ${guard}
                         RETURNING (xmax = 0) AS inserted`;
            await tx.query('SAVEPOINT rec');
            try {
              const { rows } = await tx.query(sql, [JSON.stringify(obj)]);
              await tx.query('RELEASE SAVEPOINT rec');
              if (!rows[0]) c.skipped++;
              else if (rows[0].inserted) c.created++;
              else c.updated++;
            } catch {
              // 外键缺失、id 被别的用户占用、字段不合法……都只跳过这一条
              await tx.query('ROLLBACK TO SAVEPOINT rec');
              c.skipped++;
            }
          }
          counts[e.entity] = c;
        }
        return { mode, counts };
      });
    },
  );

  app.get('/data/backup-status', async (): Promise<BackupStatus> => {
    try {
      const s = JSON.parse(await readFile(app.config.backupStatusFile, 'utf8'));
      return {
        lastBackupAt: s.lastBackupAt || null,
        lastBackupSizeBytes: typeof s.lastBackupSizeBytes === 'number' ? s.lastBackupSizeBytes : null,
        lastVerifiedAt: s.lastVerifiedAt || null,
        lastVerifyOk: typeof s.lastVerifyOk === 'boolean' ? s.lastVerifyOk : null,
        retainedCount: Number(s.retainedCount) || 0,
      };
    } catch {
      // 还没跑过备份，或状态文件不可读
      return { lastBackupAt: null, lastBackupSizeBytes: null, lastVerifiedAt: null, lastVerifyOk: null, retainedCount: 0 };
    }
  });
};
