import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { CONTRACT_VERSION } from '../../../shared/constants';
import type { HealthResponse, Settings, SettingsData } from '../../../shared/types';
import { updateVersioned } from '../db/pool';
import { AppError } from '../lib/errors';
import { isValidTimezone } from '../lib/util';
import { SettingsData as SettingsSchema, VersionedMeta } from '../schemas';
import { loadSettingsRow, settingsToApi } from '../services/settings';
import { Type } from '@sinclair/typebox';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function releasedVersion(dir: string): Promise<string> {
  const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { web?: { version?: string } };
  if (!m.web?.version) throw new Error('清单里没有版本');
  return m.web.version;
}

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/health', async (_req, reply): Promise<HealthResponse> => {
    let db: HealthResponse['db'] = 'ok';
    try {
      await app.db.query({ text: 'SELECT 1', query_timeout: 2000 } as never);
    } catch {
      db = 'down';
    }
    if (db === 'down') reply.code(503);
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      // 发版不重启服务，环境变量里的版本号会过时：以发布清单为准
      version: await releasedVersion(app.config.updatesDir).catch(() => app.config.appVersion),
      contractVersion: CONTRACT_VERSION,
      db,
      ai: app.ai.configured ? 'configured' : 'missing',
      time: new Date().toISOString(),
      ...(app.config.minClientVersion ? { minClientVersion: app.config.minClientVersion } : {}),
    };
  });
};

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/settings', async (req): Promise<Settings> => settingsToApi(await loadSettingsRow(app.db, req.userId)));

  app.put(
    '/settings',
    { schema: { body: Type.Object({ ...VersionedMeta, data: SettingsSchema }, { additionalProperties: false }) } },
    async (req): Promise<Settings> => {
      const data = req.body.data as SettingsData;
      if (!isValidTimezone(data.timezone)) {
        throw new AppError('VALIDATION_FAILED', '时区无效', [{ path: '/data/timezone', message: '不是有效的 IANA 时区' }]);
      }
      await loadSettingsRow(app.db, req.userId);
      const row = await updateVersioned(
        app.db,
        'settings',
        req.userId,
        req.userId,
        req.body.baseVersion,
        { data: JSON.stringify(data) },
        settingsToApi,
      );
      return settingsToApi(row);
    },
  );
};
