/**
 * 认证状态。status 三态：
 *   unknown —— 启动中，正用已保存的凭据（网页端 cookie / App 端安全存储）换 token，此时不做任何跳转
 *   authed  —— 已登录
 *   anon    —— 未登录
 * accessToken 到期前一分钟主动续期；页面从后台回到前台时也检查一次。
 */
import { create } from 'zustand';
import type { AuthResult, User } from '@shared/types';
import { ApiError, configureSession, endSession, persistSession, refreshSession } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { deviceId } from '@/lib/device';

type Status = 'unknown' | 'authed' | 'anon';

interface AuthState {
  status: Status;
  user: User | null;
  accessToken: string | null;
  expiresAt: number;
  /** 启动时 refresh 因断网失败：会话可能仍有效，只是暂时联系不上 */
  offlineAtBoot: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const RENEW_BEFORE_MS = 60_000;
let renewTimer: ReturnType<typeof setTimeout> | undefined;

/** 上次登录成功的用户快照：离线冷启动时凭它进入离线模式（契约 §8.5，非敏感信息） */
const USER_KEY = 'jp.user';
function loadUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function saveUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* 存不了快照就只是没有离线冷启动 */
  }
}

/** 注销时要清掉的本地数据（离线缓存、待推送队列），由 main.tsx 注入 */
let onLogout: () => Promise<void> = async () => undefined;
export function configureLogoutCleanup(fn: () => Promise<void>) {
  onLogout = fn;
}

export const useAuth = create<AuthState>((set, get) => {
  const applySession = (r: AuthResult) => {
    const expiresAt = Date.now() + r.expiresIn * 1000;
    set({ status: 'authed', user: r.user, accessToken: r.accessToken, expiresAt, offlineAtBoot: false });
    saveUser(r.user);
    clearTimeout(renewTimer);
    renewTimer = setTimeout(() => void refreshSession().catch(() => undefined), Math.max(5_000, expiresAt - Date.now() - RENEW_BEFORE_MS));
  };
  const clearSession = () => {
    clearTimeout(renewTimer);
    set({ status: 'anon', user: null, accessToken: null, expiresAt: 0 });
    saveUser(null);
    void onLogout();
  };

  configureSession({
    getToken: () => get().accessToken,
    onRefreshed: applySession,
    onSessionLost: clearSession,
  });

  return {
    status: 'unknown',
    user: null,
    accessToken: null,
    expiresAt: 0,
    offlineAtBoot: false,

    bootstrap: async () => {
      try {
        const r = await refreshSession();
        if (!r) clearSession();
      } catch (e) {
        // 联系不上服务器（断网或 5xx）：有快照就进离线模式，联网后再续期；明确失效才回登录页
        const unreachable = e instanceof ApiError && (e.code === 'NETWORK' || e.status >= 500);
        const snapshot = unreachable ? loadUser() : null;
        if (snapshot) set({ status: 'authed', user: snapshot, accessToken: null, expiresAt: 0, offlineAtBoot: true });
        else if (unreachable) set({ status: 'anon', offlineAtBoot: true });
        else clearSession();
      }
    },

    login: async (email, password) => {
      const r = await authApi.login({ email, password, deviceId: deviceId() });
      await persistSession(r);
      applySession(r);
    },

    register: async (email, password, displayName) => {
      const r = await authApi.register({ email, password, displayName });
      await persistSession(r);
      applySession(r);
    },

    logout: async () => {
      try {
        await endSession();
      } finally {
        clearSession();
      }
    },
  };
});

/** 从后台切回来时，若 token 已过期或将过期，立即续期；离线模式下联网了也立刻续期 */
if (typeof document !== 'undefined') {
  window.addEventListener('online', () => {
    if (useAuth.getState().offlineAtBoot) void refreshSession().catch(() => undefined);
  });
  document.addEventListener('visibilitychange', () => {
    const { status, expiresAt } = useAuth.getState();
    if (document.visibilityState === 'visible' && status === 'authed' && expiresAt - Date.now() < RENEW_BEFORE_MS) {
      void refreshSession().catch(() => undefined);
    }
  });
}
