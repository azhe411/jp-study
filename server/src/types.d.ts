import type { AppConfig } from './config';
import type { Db } from './db/pool';
import type { AiService } from './services/ai';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    ai: AiService;
  }
  interface FastifyRequest {
    /** 鉴权通过后的用户 id */
    userId: string;
    /** 本次请求占用的幂等键；重放时为 undefined */
    idem?: { userId: string; clientOpId: string };
  }
  interface FastifyContextConfig {
    /** 设为 false 的写接口不做幂等（计算型 POST） */
    idempotent?: boolean;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sid: string };
    user: { sub: string; sid: string };
  }
}
