/**
 * 应用装配：插件、错误格式、公开与受保护两个作用域。
 * 所有错误都从 setErrorHandler 这一扇门出去，换上统一的礼服 —— { error: { code, message, details?, requestId } }。
 */
import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { API_PREFIX } from '../../shared/constants';
import type { AppConfig } from './config';
import { createPool, type Db } from './db/pool';
import { AppError, errorBody } from './lib/errors';
import { requireAuth } from './plugins/auth';
import { registerIdempotency } from './plugins/idempotency';
import { aiRoutes } from './routes/ai';
import { aiKeyRoutes } from './routes/aiKey';
import { appUpdateRoutes } from './routes/appUpdate';
import { learnRoutes } from './routes/learn';
import { videoRoutes } from './routes/videos';
import { authPublicRoutes, meRoutes } from './routes/auth';
import { cardRoutes } from './routes/cards';
import { conversationRoutes } from './routes/conversations';
import { courseRoutes } from './routes/courses';
import { dataRoutes } from './routes/data';
import { mistakeRoutes } from './routes/mistakes';
import { phraseRoutes } from './routes/phrases';
import { practiceRoutes } from './routes/practice';
import { speakingRoutes } from './routes/speaking';
import { syncRoutes } from './routes/sync';
import { vocabTestRoutes } from './routes/vocabTest';
import { writingRoutes } from './routes/writing';
import { statsRoutes } from './routes/stats';
import { healthRoutes, settingsRoutes } from './routes/system';
import { taskRoutes } from './routes/tasks';
import { ttsFileRoutes, ttsRoutes } from './routes/tts';
import { coachRoutes } from './routes/coach';
import { AiService } from './services/ai';

/**
 * 两套校验器：URL 里的 query / params / headers 天生是字符串，需要类型强转；
 * 请求体是 JSON，类型必须如实 —— 否则 {"sortOrder": null} 会被悄悄变成 0。
 */
const AJV_BASE = { removeAdditional: true, useDefaults: true, allErrors: true, strict: false } as const;
const ajvCoercing = addFormats(new Ajv({ ...AJV_BASE, coerceTypes: 'array' }));
const ajvStrictBody = addFormats(new Ajv({ ...AJV_BASE, coerceTypes: false }));

export async function buildApp(config: AppConfig, db?: Db): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: () => `req_${randomBytes(8).toString('hex')}`,
    requestIdHeader: false,
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.accessToken',
          '*.refreshToken',
          '*.apiKey',
        ],
        censor: '[redacted]',
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(({ schema, httpPart }) => (httpPart === 'body' ? ajvStrictBody : ajvCoercing).compile(schema));

  app.decorate('config', config);
  app.decorate('db', db ?? createPool(config.databaseUrl));
  app.decorate('ai', new AiService(config.ai, app.log));
  app.decorateRequest('userId', '');
  app.addHook('onClose', async () => app.db.end());

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });

  await app.register(cookie);
  // 原生 App 跨源调用：只放行 App 来源，且不带凭据（鉴权只靠 Authorization 头）
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-client-platform'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
    maxAge: 600,
  });
  await app.register(jwt, { secret: config.jwtSecret, sign: { algorithm: 'HS256' }, verify: { algorithms: ['HS256'] } });
  await app.register(rateLimit, {
    // 兜底：每个来源每分钟的总请求数。登录这类接口在路由上有更严的限制
    global: true,
    max: 1200,
    timeWindow: '1 minute',
    // 这个头只有在请求真的来自 Cloudflare 时才可信：Caddy 会把其他来源带的删掉（deploy/Caddyfile.jp-study）
    keyGenerator: (req) => (req.headers['cf-connecting-ip'] as string | undefined) ?? req.ip,
    errorResponseBuilder: () => new AppError('RATE_LIMITED'),
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ code: err.code }, err.message);
      return reply.code(err.status).send(errorBody(err.code, err.message, req.id, err.details));
    }
    if (err.validation) {
      const details = err.validation.map((v) => {
        const missing = (v.params as { missingProperty?: string } | undefined)?.missingProperty;
        const where = err.validationContext && err.validationContext !== 'body' ? `/${err.validationContext}` : '';
        return { path: `${where}${v.instancePath}${missing ? `/${missing}` : ''}` || '/', message: v.message ?? '不合法' };
      });
      return reply.code(400).send(errorBody('VALIDATION_FAILED', '请求参数不正确', req.id, details));
    }
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send(errorBody('PAYLOAD_TOO_LARGE', '请求内容过大', req.id));
    }
    if (err.statusCode === 400 || err.statusCode === 415 || err instanceof SyntaxError) {
      return reply.code(400).send(errorBody('INVALID_JSON', '请求体不是合法的 JSON', req.id));
    }
    if (err.statusCode === 429) {
      return reply.code(429).send(errorBody('RATE_LIMITED', '操作太频繁，请稍后再试', req.id));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', '服务器开小差了，请稍后再试', req.id));
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send(errorBody('NOT_FOUND', '接口不存在', req.id)));

  await app.register(
    async (api) => {
      // 公开：健康检查与认证
      await api.register(healthRoutes);
      await api.register(appUpdateRoutes);
      await api.register(ttsFileRoutes);
      await api.register(authPublicRoutes);

      // 受保护：先验身份，再验幂等
      await api.register(async (secured) => {
        secured.addHook('onRequest', requireAuth);
        registerIdempotency(secured);
        await secured.register(meRoutes);
        await secured.register(settingsRoutes);
        await secured.register(taskRoutes);
        await secured.register(cardRoutes);
        await secured.register(statsRoutes);
        await secured.register(aiRoutes);
        await secured.register(aiKeyRoutes);
        await secured.register(mistakeRoutes);
        await secured.register(conversationRoutes);
        await secured.register(phraseRoutes);
        await secured.register(speakingRoutes);
        await secured.register(practiceRoutes);
        await secured.register(writingRoutes);
        await secured.register(vocabTestRoutes);
        await secured.register(courseRoutes);
        await secured.register(dataRoutes);
        await secured.register(syncRoutes);
        await secured.register(learnRoutes);
        await secured.register(videoRoutes);
        await secured.register(ttsRoutes);
        await secured.register(coachRoutes);
      });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
