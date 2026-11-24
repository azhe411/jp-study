/**
 * 同步状态（契约 §8.3 冲突解决）：
 *   有待补交的离线操作时显示一条安静的提示；
 *   遇到冲突逐条让用户选"保留我的修改 / 用另一台设备的版本"；
 *   被服务器拒绝的操作列出原因，可关闭。
 */
import { ArrowsClockwise, CloudArrowUp, Warning, X } from '@phosphor-icons/react';
import { dismissRejected, flush, resolveConflict, useOutbox } from '@/lib/offline/outbox';
import { useOnline } from '@/lib/hooks';
import { Button, cx } from './ui';

export function SyncStatus() {
  const online = useOnline();
  const { pending, conflicts, rejected, syncing } = useOutbox();
  const waiting = pending - conflicts.length;
  if (!waiting && !conflicts.length && !rejected.length) return null;

  return (
    <div className="space-y-2 px-4 pt-3 sm:px-6">
      {waiting > 0 && (
        <div className="mx-auto flex max-w-[832px] items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs font-semibold text-ink-2 lift" role="status">
          <CloudArrowUp weight="bold" className={cx('size-4', syncing && 'animate-pulse')} />
          <span className="flex-1">{syncing ? '正在补交离线操作…' : `${waiting} 个离线操作待补交${online ? '' : '，联网后自动进行'}`}</span>
          {online && !syncing && (
            <button onClick={() => void flush()} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-surface-2">
              <ArrowsClockwise className="size-3.5" /> 现在补交
            </button>
          )}
        </div>
      )}

      {conflicts.map((c) => (
        <div key={c.clientOpId} className="mx-auto max-w-[832px] rounded-xl bg-surface p-3 text-sm lift ring-1 ring-warn/40" role="alert">
          <p className="flex items-start gap-2 font-semibold">
            <Warning weight="fill" className="mt-0.5 size-4 shrink-0 text-warn" />
            你离线时{c.label}，但它在另一台设备上已经被改过了。保留哪一边？
          </p>
          <div className="mt-2 flex flex-wrap gap-2 pl-6">
            <Button size="sm" onClick={() => void resolveConflict(c.clientOpId, 'local')}>保留我的修改</Button>
            <Button size="sm" variant="outline" onClick={() => void resolveConflict(c.clientOpId, 'server')}>用另一台设备的版本</Button>
          </div>
        </div>
      ))}

      {rejected.length > 0 && (
        <div className="mx-auto flex max-w-[832px] items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          <ul className="flex-1 space-y-0.5">
            {rejected.map((r, i) => <li key={i}>离线时{r.label}没能补交：{r.message}</li>)}
          </ul>
          <button onClick={dismissRejected} aria-label="关闭" className="grid size-7 place-items-center rounded-md hover:bg-danger/10"><X className="size-4" /></button>
        </div>
      )}
    </div>
  );
}
