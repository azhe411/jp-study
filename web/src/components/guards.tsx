/**
 * 路由守卫。启动阶段（unknown）只显示一枚安静的日轮，不急着下结论；
 * 未登录访问受保护页 → 去登录页并记住来处；已登录访问登录页 → 回首页。
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/stores/auth';

export function BootSplash() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="正在载入">
      <div className="font-sign flex h-12 animate-pulse items-center gap-1.5 rounded-xl bg-go px-3 text-xl font-black text-go-ink"><span lang="ja">駅</span><span className="rounded-md bg-go-ink px-1.5 py-0.5 text-sm text-go">01</span></div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'unknown') return <BootSplash />;
  if (status === 'anon') {
    const from = location.pathname + location.search;
    return <Navigate to={`/login${from && from !== '/' ? `?next=${encodeURIComponent(from)}` : ''}`} replace />;
  }
  return <>{children}</>;
}

export function RequireAnon({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'unknown') return <BootSplash />;
  if (status === 'authed') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** 只接受站内相对路径，杜绝 ?next=https://evil 之类的跳转 */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}
