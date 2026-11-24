/** 有更新时的提示条：安卓热更新"重启生效"、安卓新安装包、Windows 新版本 */
import { ArrowsClockwise, DownloadSimple, X } from '@phosphor-icons/react';
import { applyUpdate, dismissUpdate, useUpdate } from '@/lib/updater';
import { Button } from './ui';

export function UpdateBanner() {
  const s = useUpdate((x) => x.state);
  if (s.kind === 'idle') return null;
  const text =
    s.kind === 'web-ready' ? `新版本 v${s.version} 已经下好，重启就能用；不点也会在下次打开时生效。`
      : s.kind === 'apk' ? `有新的安装包 v${s.version}，这次改动需要重新安装（数据不会丢）。`
        : s.kind === 'desktop' ? `有新版本 v${s.version}，点一下自动下载安装并重启。`
          : s.pct === null ? `正在准备安装 v${s.version}，安装时软件会自动关闭并重新打开……` : `正在下载 v${s.version}：${s.pct}%`;
  return (
    <div className="px-4 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-[832px] flex-wrap items-center gap-3 rounded-xl bg-go-soft px-3 py-2.5 text-sm" role="status">
        <ArrowsClockwise weight="bold" className="size-4 text-ok" />
        <span className="min-w-0 flex-1">
          {text}
          {'notes' in s && s.notes && <span className="block text-xs text-ink-3">{s.notes}</span>}
          {s.kind === 'desktop' && s.error && <span className="block text-xs text-danger">更新失败：{s.error}。可以再试一次，或从官网下载安装包。</span>}
          {s.kind === 'installing' && s.pct !== null && (
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface">
              <span className="block h-full rounded-full bg-go transition-[width]" style={{ width: `${s.pct}%` }} />
            </span>
          )}
        </span>
        {s.kind !== 'installing' && (
          <>
            <Button size="sm" icon={s.kind === 'apk' ? DownloadSimple : ArrowsClockwise} onClick={() => void applyUpdate()}>
              {s.kind === 'web-ready' ? '现在重启' : s.kind === 'apk' ? '下载安装包' : s.kind === 'desktop' && s.error ? '再试一次' : '现在更新'}
            </Button>
            <button onClick={dismissUpdate} aria-label="稍后" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface"><X className="size-4" /></button>
          </>
        )}
      </div>
    </div>
  );
}
