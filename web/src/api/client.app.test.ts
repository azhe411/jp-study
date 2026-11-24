/** App 端（契约 v1.1.0 §12.2）：refresh token 走请求/响应体 + 安全存储 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let failWrites = false;

vi.mock('@/platform', () => ({ platform: 'android', isApp: true, apiOrigin: 'https://jp.azclient.top' }));
vi.mock('@/platform/secrets', () => ({
  REFRESH_TOKEN_KEY: 'jp.refreshToken',
  secrets: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      if (failWrites) throw new Error('keystore unavailable');
      store.set(k, v);
    },
    remove: async (k: string) => void store.delete(k),
  },
}));

const { api, configureSession, endSession, persistSession, refreshSession } = await import('./client');

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const auth = (access: string, refresh: string) => ({
  accessToken: access,
  expiresIn: 900,
  refreshToken: refresh,
  refreshExpiresIn: 2_592_000,
  user: { id: 'u', email: 'a@b.c', displayName: 'a', createdAt: '' },
});

let token: string | null;
let lost: number;
let fetchMock: ReturnType<typeof vi.fn>;
const init = (i: number) => fetchMock.mock.calls[i][1] as RequestInit;
const hdr = (i: number) => init(i).headers as Record<string, string>;

beforeEach(() => {
  store.clear();
  failWrites = false;
  token = null;
  lost = 0;
  configureSession({ getToken: () => token, onRefreshed: (r) => (token = r.accessToken), onSessionLost: () => lost++ });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('api client（App 端）', () => {
  it('请求走绝对地址、带平台头、不带 cookie', async () => {
    token = 'acc';
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await api('/me');
    expect(fetchMock.mock.calls[0][0]).toBe('https://jp.azclient.top/api/v1/me');
    expect(hdr(0)['x-client-platform']).toBe('android');
    expect(hdr(0).authorization).toBe('Bearer acc');
    expect(init(0).credentials).toBe('omit');
  });

  it('刷新：请求体提交已存的 token，并把轮换出的新 token 覆盖保存', async () => {
    store.set('jp.refreshToken', 'rt-1');
    fetchMock.mockResolvedValueOnce(json(200, auth('acc-2', 'rt-2')));
    const r = await refreshSession();
    expect(r?.accessToken).toBe('acc-2');
    expect(JSON.parse(init(0).body as string)).toEqual({ refreshToken: 'rt-1' });
    expect(store.get('jp.refreshToken')).toBe('rt-2');
    expect(token).toBe('acc-2');
  });

  it('没有保存的 token：不发请求，直接视为未登录', async () => {
    await expect(refreshSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('服务端拒绝刷新：清掉本地保存的 token', async () => {
    store.set('jp.refreshToken', 'stale');
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'REFRESH_TOKEN_INVALID', message: '失效', requestId: 'r' } }));
    await expect(refreshSession()).resolves.toBeNull();
    expect(store.has('jp.refreshToken')).toBe(false);
  });

  it('断网时刷新：保留本地 token，不判定为登出', async () => {
    store.set('jp.refreshToken', 'rt-1');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(refreshSession()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(store.get('jp.refreshToken')).toBe('rt-1');
    expect(lost).toBe(0);
  });

  it('安全存储写入失败：刷新视为失败（需要重新登录）', async () => {
    store.set('jp.refreshToken', 'rt-1');
    failWrites = true;
    fetchMock.mockResolvedValueOnce(json(200, auth('acc-2', 'rt-2')));
    await expect(refreshSession()).resolves.toBeNull();
    expect(token).toBeNull();
  });

  it('登录结果缺少 refreshToken 时拒绝保存', async () => {
    const { refreshToken: _r, ...noRefresh } = auth('a', 'r');
    await expect(persistSession(noRefresh)).rejects.toMatchObject({ code: 'SECURE_STORAGE' });
  });

  it('注销：请求体带 token 通知服务端，并清空本地', async () => {
    store.set('jp.refreshToken', 'rt-9');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await endSession();
    expect(fetchMock.mock.calls[0][0]).toBe('https://jp.azclient.top/api/v1/auth/logout');
    expect(JSON.parse(init(0).body as string)).toEqual({ refreshToken: 'rt-9' });
    expect(store.size).toBe(0);
  });
});
