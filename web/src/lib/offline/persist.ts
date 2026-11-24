/**
 * 离线读取：把 React Query 的成功结果存进 IndexedDB，下次启动（包括断网时）先用它渲染。
 * 只存成功的查询；超过 7 天的缓存不再恢复；软件版本变了也不恢复（否则更新后还在显示旧内容）；注销时清空。
 */
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { db } from './outbox';

const KEY = 'query-cache';
const MAX_AGE_MS = 7 * 86400_000;

export async function restoreCache(qc: QueryClient): Promise<void> {
  try {
    const saved = (await (await db()).get('kv', KEY)) as { at: number; version?: string; state: DehydratedState } | undefined;
    if (saved && saved.version === __APP_VERSION__ && Date.now() - saved.at < MAX_AGE_MS) hydrate(qc, saved.state);
  } catch {
    /* IndexedDB 不可用（隐私模式等）：照常在线运行 */
  }
}

export function persistCache(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const state = dehydrate(qc, { shouldDehydrateQuery: (q) => q.state.status === 'success' && !q.queryKey.includes('noPersist') });
        await (await db()).put('kv', { at: Date.now(), version: __APP_VERSION__, state }, KEY);
      } catch {
        /* 存不下就算了，不影响使用 */
      }
    }, 1500);
  };
  return qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.action.type === 'success') save();
  });
}

export async function clearCache(qc: QueryClient): Promise<void> {
  qc.clear();
  try {
    await (await db()).delete('kv', KEY);
  } catch {
    /* ignore */
  }
}
