/**
 * 应用更新（契约 §16），无需登录。
 * 更新文件与清单由发布脚本放在服务器的 updates 目录（只读挂载进容器）：
 *   manifest.json —— { web, android, desktop }，desktop 额外带 file 与 signature（Tauri 签名）
 * 清单里的文件名在这里拼成完整下载地址。
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { MIRROR_MIN_CLIENT_VERSION } from '../../../shared/constants';
import type { AppManifest } from '../../../shared/types';
import { notFound } from '../lib/errors';
import { compareSemver } from '../lib/util';

interface StoredManifest {
  web?: { version: string; file: string; sha256: string; notes: string };
  android?: { version: string; versionCode: number; file: string; sha256?: string; notes: string };
  desktop?: { version: string; file: string; sha256?: string; signature: string; notes: string; pubDate: string };
}

const TYPES: Record<string, string> = {
  zip: 'application/zip',
  apk: 'application/vnd.android.package-archive',
  exe: 'application/vnd.microsoft.portable-executable',
  sig: 'text/plain; charset=utf-8',
  json: 'application/json',
};

export const appUpdateRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const dir = app.config.updatesDir;
  const fileUrl = (name: string) => `${app.config.publicBaseUrl}/api/v1/app/files/${encodeURIComponent(name)}`;
  // 国内下载镜像（发版脚本会先把文件传过去）。它是 http，旧版更新器不认，所以每处都要看客户端能不能用
  const mirror = app.config.downloadBaseUrl;
  const mirrorUrl = (name: string) => (mirror ? `${mirror}/files/${encodeURIComponent(name)}` : null);

  async function manifest(): Promise<StoredManifest> {
    try {
      return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  app.get('/app/manifest', async (): Promise<AppManifest> => {
    const m = await manifest();
    return {
      web: m.web ? { version: m.web.version, url: fileUrl(m.web.file), mirrorUrl: mirrorUrl(m.web.file), sha256: m.web.sha256, notes: m.web.notes } : null,
      // 安装包是交给系统浏览器下载的，任何版本都能用 http
      android: m.android ? { version: m.android.version, versionCode: m.android.versionCode, url: mirrorUrl(m.android.file) ?? fileUrl(m.android.file), sha256: m.android.sha256 ?? null, notes: m.android.notes } : null,
      desktop: m.desktop ? { version: m.desktop.version, sha256: m.desktop.sha256 ?? null, notes: m.desktop.notes } : null,
    };
  });

  /**
   * v1.6.1：固定的"最新版"下载地址，按清单 302 跳到当前文件。官网写死这个地址即可，
   * 发版不用改官网，页面脚本读不到清单时也不会下到旧版。
   */
  app.get('/app/latest/:target', { schema: { params: Type.Object({ target: Type.Union([Type.Literal('android'), Type.Literal('windows')]) }), querystring: Type.Object({ via: Type.Optional(Type.Literal('hk')) }) } }, async (req, reply) => {
    const m = await manifest();
    const file = req.params.target === 'android' ? m.android?.file : m.desktop?.file;
    if (!file) throw notFound('还没有发布这个平台的安装包');
    reply.header('cache-control', 'no-cache');
    // ?via=hk 是官网的备用线路（有些浏览器会拦 https 页面发起的 http 下载）。相对地址：从哪个入口（jp / jpd）来，就从哪个入口下载
    const direct = req.query.via === 'hk' ? null : mirrorUrl(file);
    return reply.redirect(direct ?? `/api/v1/app/files/${encodeURIComponent(file)}`, 302);
  });

  /** v1.6.0：离线语音识别模型，文件名带版本号，内容不变，永久缓存 */
  app.get('/app/models/:name', { schema: { params: Type.Object({ name: Type.String({ pattern: '^[A-Za-z0-9._-]{1,120}$' }) }) } }, async (req, reply) => {
    const path = join(app.config.modelsDir, req.params.name);
    const s = await stat(path).catch(() => null);
    if (!s?.isFile()) throw notFound('模型不存在');
    reply.header('content-type', req.params.name.endsWith('.tar.gz') ? 'application/gzip' : 'application/octet-stream');
    reply.header('content-length', s.size);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(path));
  });

  app.get('/app/files/:name', { schema: { params: Type.Object({ name: Type.String({ pattern: '^[A-Za-z0-9._-]{1,120}$' }) }) } }, async (req, reply) => {
    const path = join(dir, req.params.name);
    const s = await stat(path).catch(() => null);
    if (!s?.isFile()) throw notFound('文件不存在');
    const ext = req.params.name.split('.').pop() ?? '';
    reply.header('content-type', TYPES[ext] ?? 'application/octet-stream');
    reply.header('content-length', s.size);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    if (ext === 'apk' || ext === 'exe') reply.header('content-disposition', `attachment; filename="${req.params.name}"`);
    return reply.send(createReadStream(path));
  });

  // Tauri 更新器协议：有新版本返回 JSON，否则 204
  app.get(
    '/app/desktop/:target/:arch/:currentVersion',
    { schema: { params: Type.Object({ target: Type.String({ maxLength: 20 }), arch: Type.String({ maxLength: 20 }), currentVersion: Type.String({ maxLength: 30 }) }) } },
    async (req, reply) => {
      const d = (await manifest()).desktop;
      if (!d || compareSemver(req.params.currentVersion, d.version) >= 0) return reply.code(204).send();
      return {
        version: d.version,
        notes: d.notes,
        pub_date: d.pubDate,
        // 旧版更新器拒绝 http，继续走香港；新版走国内（安装前会校验签名，http 不影响安全）
        platforms: { [`${req.params.target}-${req.params.arch}`]: { signature: d.signature, url: (compareSemver(req.params.currentVersion, MIRROR_MIN_CLIENT_VERSION) >= 0 && mirrorUrl(d.file)) || fileUrl(d.file) } },
      };
    },
  );
};
