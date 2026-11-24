import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors';

/**
 * 受保护路由的 onRequest 钩子。
 * 过期与伪造分开报：前者值得一次静默刷新，后者只配被请回登录页。
 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.headers.authorization?.startsWith('Bearer ')) throw new AppError('UNAUTHORIZED');
  try {
    await req.jwtVerify();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') throw new AppError('TOKEN_EXPIRED');
    throw new AppError('UNAUTHORIZED');
  }
  req.userId = req.user.sub;
}
