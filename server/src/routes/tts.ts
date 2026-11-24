/**
 * 朗读音频（契约 v1.5.0 §18）。
 *   GET  /tts/:key.mp3   公开：已生成的音频文件，内容寻址，永久缓存
 *   POST /tts            需登录：给一段日语，确保音频存在，返回它的地址
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { TtsResult } from '../../../shared/types';
import { AppError, notFound } from '../lib/errors';
import { TTS_MAX_CHARS, ensureAudio, hasJapanese, ttsPath } from '../services/tts';

export const ttsFileRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/tts/:file',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } }, schema: { params: Type.Object({ file: Type.String({ pattern: '^[0-9a-f]{40}\\.mp3$' }) }) } },
    async (req, reply) => {
      const key = req.params.file.slice(0, 40);
      const path = ttsPath(app.config.audioDir, key);
      const s = await stat(path).catch(() => null);
      if (!s?.isFile()) throw notFound('这段音频还没有生成');
      reply.header('content-type', 'audio/mpeg');
      reply.header('content-length', s.size);
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return reply.send(createReadStream(path));
    },
  );
};

export const ttsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/tts',
    {
      config: { idempotent: false, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { body: Type.Object({ text: Type.String({ minLength: 1, maxLength: TTS_MAX_CHARS }) }, { additionalProperties: false }) },
    },
    async (req): Promise<TtsResult> => {
      if (!hasJapanese(req.body.text)) throw new AppError('VALIDATION_FAILED', '只能朗读日语', [{ path: '/text', message: '没有假名或汉字' }]);
      const key = await ensureAudio(app.config.audioDir, app.config.ttsVoice, req.body.text);
      return { key, url: `/api/v1/tts/${key}.mp3`, voice: app.config.ttsVoice };
    },
  );
};
