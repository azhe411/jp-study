/**
 * API 客户端 —— 前端与后端之间唯一的门。
 *
 * · accessToken 只活在内存里。
 * · refresh token：网页端由浏览器以 httpOnly cookie 代管，脚本碰不到；
 *   App 端（契约 v1.1.0 §12.2）走请求/响应体，存系统安全存储，每次刷新都覆盖成新的。
 * · 收到 401 TOKEN_EXPIRED：单飞（single-flight）刷新一次，再原样重放请求一次。
 *   同时涌来的十个过期请求，只会换来一次刷新。
 * · 刷新失败即视为登出，通知上层回到登录页；断网则不算登出。
 * · 错误一律化为 ApiError，message 是后端给的中文提示，可直接展示。
 */
import { API_PREFIX, CLIENT_PLATFORM_HEADER, type ErrorCode } from '@shared/constants';
import type { ApiError as ApiErrorBody, AuthResult, RefreshRequest } from '@shared/types';
import { apiOrigin, isApp, platform } from '@/platform';
import { REFRESH_TOKEN_KEY, secrets } from '@/platform/secrets';

/** QUEUED：断网时写操作已进 outbox，联网后自动补交（不算失败，但界面要告诉用户） */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'SECURE_STORAGE' | 'QUEUED';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface SessionHooks {
  getToken: () => string | null;
  onRefreshed: (result: AuthResult) => void;
  onSessionLost: () => void;
}

let hooks: SessionHooks = {
  getToken: () => null,
  onRefreshed: () => undefined,
  onSessionLost: () => undefined,
};

/** 由认证 store 在启动时注入，避免 client ↔ store 循环依赖 */
export function configureSession(h: SessionHooks): void {
  hooks = h;
}

/** 断网时尝试把写请求转存进 outbox；转存成功返回 true（由 main.tsx 注入） */
type QueueWrite = (method: string, path: string, body: Record<string, unknown> | undefined, query: Record<string, unknown> | undefined) => Promise<boolean>;
let queueWrite: QueueWrite | null = null;
export function configureQueue(q: QueueWrite): void {
  queueWrite = q;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** false：不带 accessToken、不触发自动刷新（登录/注册/刷新自身） */
  auth?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return `${apiOrigin}${API_PREFIX}${path}${s ? `?${s}` : ''}`;
}

async function send<T>(path: string, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  // 网页端不带平台头：请求与 v1.0.0 逐字节一致
  if (isApp) headers[CLIENT_PLATFORM_HEADER.toLowerCase()] = platform;
  const token = opts.auth === false ? null : hooks.getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      // App 跨源调用从不带 cookie，鉴权只靠 Authorization 头
      credentials: isApp ? 'omit' : 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', '网络连接失败，请检查网络后重试');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.ok) return data as T;

  const err = (data as ApiErrorBody | null)?.error;
  throw new ApiError(
    res.status,
    err?.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'UNPROCESSABLE'),
    err?.message ?? `请求失败（${res.status}）`,
    err?.details,
    err?.requestId,
  );
}

/* ───────────── 会话持久化（仅 App 端有实际动作） ───────────── */

/** 登录 / 注册 / 刷新成功后调用：App 端把新的 refresh token 写入安全存储 */
export async function persistSession(r: AuthResult): Promise<void> {
  if (!isApp) return;
  if (!r.refreshToken) throw new ApiError(0, 'SECURE_STORAGE', '服务器没有返回登录凭据，请更新应用后重试');
  try {
    await secrets.set(REFRESH_TOKEN_KEY, r.refreshToken);
  } catch {
    throw new ApiError(0, 'SECURE_STORAGE', '无法在本机安全保存登录状态，请重新登录');
  }
}

/** 注销：通知服务端吊销 refresh token，再清掉本地保存 */
export async function endSession(): Promise<void> {
  const stored = isApp ? await secrets.get(REFRESH_TOKEN_KEY).catch(() => null) : null;
  try {
    await send<void>('/auth/logout', {
      method: 'POST',
      auth: false,
      body: stored ? ({ refreshToken: stored } satisfies RefreshRequest) : undefined,
    });
  } finally {
    if (isApp) await secrets.remove(REFRESH_TOKEN_KEY).catch(() => undefined);
  }
}

/* ───────────── 单飞刷新 ───────────── */

let inflight: Promise<AuthResult | null> | null = null;

async function doRefresh(): Promise<AuthResult | null> {
  let body: RefreshRequest | undefined;
  if (isApp) {
    const stored = await secrets.get(REFRESH_TOKEN_KEY).catch(() => null);
    if (!stored) return null; // 从未登录，或已注销
    body = { refreshToken: stored };
  }
  let r: AuthResult;
  try {
    r = await send<AuthResult>('/auth/refresh', { method: 'POST', auth: false, body });
  } catch (e) {
    // 断网或服务端出错（5xx）都不等于登出：保留凭据，交给上层进入离线模式（契约 §8.5）
    if (e instanceof ApiError && (e.code === 'NETWORK' || e.status >= 500)) throw e;
    if (isApp) await secrets.remove(REFRESH_TOKEN_KEY).catch(() => undefined);
    return null;
  }
  try {
    await persistSession(r);
  } catch {
    // 新 token 存不下来，旧 token 又已被服务端作废：只能请用户重新登录
    return null;
  }
  hooks.onRefreshed(r);
  return r;
}

/** 用保存的凭据换新的 accessToken；并发调用共享同一次请求。失败返回 null */
export function refreshSession(): Promise<AuthResult | null> {
  inflight ??= doRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return await sendAuthed<T>(path, opts);
  } catch (e) {
    const method = opts.method ?? 'GET';
    if (e instanceof ApiError && e.code === 'NETWORK' && method !== 'GET' && queueWrite) {
      const queued = await queueWrite(method, path, opts.body as Record<string, unknown> | undefined, opts.query as Record<string, unknown> | undefined).catch(() => false);
      if (queued) throw new ApiError(0, 'QUEUED', '离线中：这次操作已暂存，联网后会自动补交');
    }
    throw e;
  }
}

async function sendAuthed<T>(path: string, opts: RequestOptions): Promise<T> {
  try {
    return await send<T>(path, opts);
  } catch (e) {
    const expired = e instanceof ApiError && e.status === 401 && (e.code === 'TOKEN_EXPIRED' || e.code === 'UNAUTHORIZED');
    if (!expired || opts.auth === false) throw e;
    const refreshed = await refreshSession();
    if (!refreshed) {
      hooks.onSessionLost();
      throw e;
    }
    return send<T>(path, opts);
  }
}

/** 写操作的幂等键 */
export const newClientOpId = (): string => crypto.randomUUID();
