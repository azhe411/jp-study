import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, configureQueue } from '@/api/client';
import { syncApi } from '@/api/endpoints';
import { deviceId } from '@/lib/device';
import { clearOutbox, configureOutbox, enqueue, flush, opFromRequest } from '@/lib/offline/outbox';
import { clearCache, persistCache, restoreCache } from '@/lib/offline/persist';
import { configureLogoutCleanup, useAuth } from '@/stores/auth';
import { checkForUpdates, markAppReady, checkOnResume } from '@/lib/updater';
import { applyTheme, storedTheme } from '@/lib/hooks';
import { App } from './App';
import './index.css';

// 宣传页是独立的静态目录；不带斜杠的 /get 会落到这里，送回去
if (location.pathname === '/get') location.replace('/get/');

// 首帧前按上次的选择着色，免得深色用户先被白屏晃一下
applyTheme(storedTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // 4xx 是确定的答案，不必再问；网络与 5xx 才值得重试
      retry: (count, e) => count < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
      // 离线缓存最多保留一周，渲染时先用它
      gcTime: 7 * 86400_000,
    },
    mutations: { retry: false },
  },
});

// 仅开发：/?preview 用示例数据看界面（生产构建里这段整个被摇掉）
if (import.meta.env.DEV && (location.search.includes('preview') || sessionStorage.getItem('jp.preview'))) {
  sessionStorage.setItem('jp.preview', '1');
  await import('./dev/mock');
}

/* ───────────── 离线：缓存恢复、写入排队、联网补交 ───────────── */

await restoreCache(queryClient);
persistCache(queryClient);
configureQueue(async (method, path, body, query) => {
  const op = opFromRequest(method, path, body, query, useAuth.getState().user?.id ?? null);
  if (!op) return false;
  await enqueue(op);
  return true;
});
configureOutbox(
  async (ops) => (await syncApi.push({ deviceId: deviceId(), ops })).results,
  () => void queryClient.invalidateQueries(),
);
configureLogoutCleanup(async () => {
  await clearOutbox().catch(() => undefined);
  await clearCache(queryClient);
});
// 先推后拉（契约 §8.5）：推完再让查询重新取数
const kick = () => {
  if (useAuth.getState().accessToken) void flush();
};
window.addEventListener('online', kick);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());
setInterval(kick, 60_000);
useAuth.subscribe((s, prev) => {
  if (s.accessToken && !prev.accessToken) kick();
});

/* ───────────── 软件内更新：启动即确认本版可用，稍后检查新版本；之后每 6 小时查一次 ───────────── */
void markAppReady();
setTimeout(() => void checkForUpdates(), 5_000);
setInterval(() => void checkForUpdates(), 6 * 3600_000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkOnResume());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
