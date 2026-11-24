import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, configureSession, refreshSession } from './client';

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const expired = () => json(401, { error: { code: 'TOKEN_EXPIRED', message: '登录已过期', requestId: 'r1' } });
const auth = (token: string) => ({ accessToken: token, expiresIn: 900, user: { id: 'u', email: 'a@b.c', displayName: 'a', createdAt: '' } });

let token: string | null;
let lost: number;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  token = 'old';
  lost = 0;
  configureSession({ getToken: () => token, onRefreshed: (r) => (token = r.accessToken), onSessionLost: () => lost++ });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urlOf = (call: unknown[]) => String(call[0]);
const authOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>).authorization;

describe('api client', () => {
  it('过期后单次刷新并以新 token 重放', async () => {
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(200, auth('new')))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(api('/me')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls.map(urlOf)).toEqual(['/api/v1/me', '/api/v1/auth/refresh', '/api/v1/me']);
    expect(authOf(fetchMock.mock.calls[0])).toBe('Bearer old');
    expect(authOf(fetchMock.mock.calls[2])).toBe('Bearer new');
  });

  it('并发的多个过期请求只触发一次刷新', async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, auth('new'));
      }
      const h = init.headers as Record<string, string>;
      return h.authorization === 'Bearer new' ? json(200, { url }) : expired();
    });
    const results = await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it('刷新失败则通知会话丢失并抛出原错误', async () => {
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(401, { error: { code: 'REFRESH_TOKEN_INVALID', message: '失效', requestId: 'r2' } }));
    await expect(api('/me')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(lost).toBe(1);
  });

  it('auth:false 的请求不触发刷新', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确', requestId: 'r3' } }));
    await expect(api('/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: '邮箱或密码不正确',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('断网化为 NETWORK 错误；刷新时断网不判定为登出', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/me')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    await expect(refreshSession()).rejects.toBeInstanceOf(ApiError);
    expect(lost).toBe(0);
  });

  it('204 返回 undefined；query 参数拼接并跳过空值', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api('/tasks/x', { method: 'DELETE', query: { clientOpId: 'k', baseVersion: undefined } })).resolves.toBeUndefined();
    expect(urlOf(fetchMock.mock.calls[0])).toBe('/api/v1/tasks/x?clientOpId=k');
  });
});
