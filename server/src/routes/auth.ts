/**
 * 认证：register / login / refresh / logout（公开作用域）与 me（受保护作用域）。
 *
 * refresh token 是 256 位随机串，库里只存其 SHA-256；同一登录会话为一个 family，
 * 每次刷新作废旧串、签发新串。若已作废的旧串再次出现 —— 视为被盗用，整族吊销。
 * 唯一的宽限：因轮换而作废、且不足 10 秒的旧串（多标签页同时醒来）不算盗用；注销作废的不在此列。
 *
 * v1.1.0：X-Client-Platform 为 android / desktop 时，refresh token 改走请求/响应体、不设 cookie；
 * 服务端读取顺序为"请求体优先，其次 cookie"。web 端行为与 v1.0.0 一致。
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import argon2 from 'argon2';
import { AUTH, BODY_TOKEN_PLATFORMS, CLIENT_PLATFORMS, type ClientPlatform } from '../../../shared/constants';
import type { AuthResult, MeResponse, User } from '../../../shared/types';
import { withTx, type Queryable } from '../db/pool';
import { AppError } from '../lib/errors';
import { sha256, uuid } from '../lib/util';
import { Lit } from '../schemas';
import { seedNewUser } from '../services/settings';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const REUSE_GRACE_SECONDS = 10;
const AUTH_RATE = { rateLimit: { max: 10, timeWindow: '1 minute' } };

// 用户不存在时也跑一次哈希校验，免得响应时间泄露邮箱是否注册
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= argon2.hash('not-a-real-password', ARGON_OPTS));

type Row = Record<string, unknown>;

const PlatformHeaders = Type.Object({ 'x-client-platform': Type.Optional(Lit(CLIENT_PLATFORMS)) });
/** refresh / logout 的可选请求体：无请求体时 Fastify 以 null 校验 */
const TokenBody = Type.Union([
  Type.Null(),
  Type.Object({ refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, { additionalProperties: false }),
]);

const platformOf = (req: FastifyRequest): ClientPlatform =>
  (req.headers['x-client-platform'] as ClientPlatform | undefined) ?? 'web';
const usesBodyToken = (p: ClientPlatform) => (BODY_TOKEN_PLATFORMS as readonly ClientPlatform[]).includes(p);

const userToApi = (row: Row): User => ({
  id: row.id as string,
  email: row.email as string,
  displayName: row.display_name as string,
  createdAt: (row.created_at as Date).toISOString(),
});

async function issueTokens(
  app: FastifyInstance,
  q: Queryable,
  reply: FastifyReply,
  user: Row,
  familyId: string,
  deviceId: string | null,
  platform: ClientPlatform,
): Promise<AuthResult & { tokenId: string }> {
  const refreshToken = randomBytes(32).toString('base64url');
  const id = uuid();
  await q.query(
    `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, device_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [id, user.id, familyId, sha256(refreshToken), deviceId, AUTH.refreshTokenTtlDays],
  );
  const inBody = usesBodyToken(platform);
  if (!inBody) {
    reply.setCookie(AUTH.refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: app.config.cookieSecure,
      sameSite: 'strict',
      path: AUTH.refreshCookiePath,
      maxAge: AUTH.refreshTokenTtlDays * 86_400,
    });
  }
  const accessToken = app.jwt.sign({ sub: user.id as string, sid: familyId }, { expiresIn: AUTH.accessTokenTtlSeconds });
  return {
    accessToken,
    expiresIn: AUTH.accessTokenTtlSeconds,
    user: userToApi(user),
    ...(inBody ? { refreshToken, refreshExpiresIn: AUTH.refreshTokenTtlDays * 86_400 } : {}),
    tokenId: id,
  };
}

const stripTokenId = ({ tokenId: _t, ...rest }: AuthResult & { tokenId: string }): AuthResult => rest;

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(AUTH.refreshCookieName, { path: AUTH.refreshCookiePath });
}

export const authPublicRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const Email = Type.String({ format: 'email', maxLength: 254 });

  app.post(
    '/auth/register',
    {
      config: AUTH_RATE,
      schema: {
        headers: PlatformHeaders,
        body: Type.Object(
          {
            email: Email,
            password: Type.String({ minLength: AUTH.passwordMinLength, maxLength: AUTH.passwordMaxLength }),
            displayName: Type.String({ minLength: 1, maxLength: 40 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      if (!app.config.allowRegister) throw new AppError('FORBIDDEN', '注册已关闭');
      const { email, password, displayName } = req.body;
      const hash = await argon2.hash(password, ARGON_OPTS);
      const result = await withTx(app.db, async (tx) => {
        let user: Row;
        try {
          const { rows } = await tx.query(
            'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *',
            [email.trim(), hash, displayName.trim()],
          );
          user = rows[0];
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw new AppError('EMAIL_TAKEN');
          throw e;
        }
        await seedNewUser(tx, user.id as string);
        return stripTokenId(await issueTokens(app, tx, reply, user, uuid(), null, platformOf(req)));
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    '/auth/login',
    {
      config: AUTH_RATE,
      schema: {
        headers: PlatformHeaders,
        body: Type.Object(
          {
            email: Type.String({ maxLength: 254 }),
            password: Type.String({ maxLength: AUTH.passwordMaxLength }),
            deviceId: Type.Optional(Type.String({ maxLength: 64 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const { email, password, deviceId } = req.body;
      const { rows } = await app.db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
      const user = rows[0];
      const ok = await argon2.verify(user ? (user.password_hash as string) : await getDummyHash(), password).catch(() => false);
      if (!user || !ok) throw new AppError('INVALID_CREDENTIALS');
      return stripTokenId(await issueTokens(app, app.db, reply, user, uuid(), deviceId ?? null, platformOf(req)));
    },
  );

  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { headers: PlatformHeaders, body: TokenBody } },
    async (req, reply) => {
      const fromBody = req.body?.refreshToken;
      const token = fromBody ?? req.cookies[AUTH.refreshCookieName];
      if (!token) throw new AppError('REFRESH_TOKEN_INVALID');
      // 盗用时的整族吊销必须真正提交，所以事务内只"报告"结果，出事务后再抛错
      const outcome = await withTx(app.db, async (tx) => {
        const { rows } = await tx.query(
          `SELECT rt.*, (rt.replaced_by IS NOT NULL AND rt.revoked_at > now() - make_interval(secs => $2)) AS in_grace, (rt.expires_at < now()) AS expired
             FROM refresh_tokens rt WHERE token_hash = $1 FOR UPDATE`,
          [sha256(token), REUSE_GRACE_SECONDS],
        );
        const rt = rows[0];
        if (!rt || rt.expired) return { ok: false as const };
        if (rt.revoked_at && !rt.in_grace) {
          await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
            rt.family_id,
          ]);
          req.log.warn({ familyId: rt.family_id }, 'refresh token reuse detected; family revoked');
          return { ok: false as const };
        }
        const { rows: users } = await tx.query('SELECT * FROM users WHERE id = $1', [rt.user_id]);
        if (!users[0]) return { ok: false as const };
        const result = await issueTokens(app, tx, reply, users[0], rt.family_id as string, rt.device_id as string | null, platformOf(req));
        if (!rt.revoked_at) {
          await tx.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [rt.id, result.tokenId]);
        }
        return { ok: true as const, result: stripTokenId(result) };
      });
      if (!outcome.ok) {
        if (!fromBody) clearRefreshCookie(reply);
        throw new AppError('REFRESH_TOKEN_INVALID');
      }
      return outcome.result;
    },
  );

  app.post('/auth/logout', { schema: { headers: PlatformHeaders, body: TokenBody } }, async (req, reply) => {
    const fromBody = req.body?.refreshToken;
    const token = fromBody ?? req.cookies[AUTH.refreshCookieName];
    if (token) {
      await app.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
        sha256(token),
      ]);
    }
    if (!fromBody) clearRefreshCookie(reply);
    return reply.code(204).send();
  });
};

export const meRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/me', async (req): Promise<MeResponse> => {
    const { rows } = await app.db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) throw new AppError('UNAUTHORIZED');
    return { user: userToApi(rows[0]), serverTime: new Date().toISOString() };
  });
};
