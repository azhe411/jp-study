/** 新版本就绪时轻声提示，由用户决定何时刷新 —— 不在背单词的半途抢走页面 */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { isApp } from '@/platform';
import { Button } from './ui';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export function PwaPrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    // 原生壳自带离线资源，不需要 Service Worker
    if (isApp || updateSW || !('serviceWorker' in navigator)) return;
    updateSW = registerSW({
      onNeedRefresh: () => setNeedRefresh(true),
      onOfflineReady: () => {
        setOfflineReady(true);
        setTimeout(() => setOfflineReady(false), 4000);
      },
    });
  }, []);

  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="fixed inset-x-4 bottom-[calc(5rem+var(--sab))] z-30 mx-auto max-w-sm rounded-2xl bg-surface p-3 lift ring-1 ring-line md:bottom-6" role="status">
      {needRefresh ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm">有新版本可用</p>
          <Button variant="ghost" onClick={() => setNeedRefresh(false)}>稍后</Button>
          <Button onClick={() => void updateSW?.(true)}>刷新</Button>
        </div>
      ) : (
        <p className="text-sm">已可离线打开</p>
      )}
    </div>
  );
}
