/**
 * 设置页的"数据"与"关于"：
 *   导出全部数据为 JSON 文件；从文件导入（合并 / 覆盖）；服务器备份状态；版本与连接状态。
 */
import { CloudCheck, DownloadSimple, UploadSimple, Warning } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ImportMode } from '@shared/constants';
import type { ExportBundle, ImportDataResult } from '@shared/types';
import { aiKeyApi, dataApi, systemApi } from '@/api/endpoints';
import { Button, Card, Notice, Segmented, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { checkNow } from '@/lib/updater';
import { platform } from '@/platform';

/**
 * 保存导出文件。浏览器与 Windows（WebView2）走普通下载；
 * 安卓 WebView 不处理 <a download>，改用 Filesystem 插件写进"文档/jp-study/"。返回给用户看的位置说明。
 */
async function saveExport(bundle: ExportBundle): Promise<string> {
  const name = `jp-study-${bundle.exportedAt.slice(0, 10)}.json`;
  if (platform === 'android') {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({ path: `jp-study/${name}`, data: JSON.stringify(bundle), directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    return `已保存到 文档/jp-study/${name}`;
  }
  download(bundle, name);
  return `已下载 ${name}`;
}

function download(bundle: ExportBundle, name: string) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function DataCard() {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [picked, setPicked] = useState<{ name: string; bundle: ExportBundle } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const backup = useQuery({ queryKey: ['backup'], queryFn: dataApi.backup, staleTime: 5 * 60_000 });
  const exp = useMutation({ mutationFn: async () => saveExport(await dataApi.export()) });
  const imp = useMutation({
    mutationFn: () => dataApi.import(mode, picked!.bundle),
    onSuccess: () => void qc.invalidateQueries(),
  });

  async function onFile(f: File | undefined) {
    setParseError(null);
    setPicked(null);
    imp.reset();
    if (!f) return;
    try {
      const bundle = JSON.parse(await f.text()) as ExportBundle;
      if (bundle.formatVersion !== 1 || typeof bundle.entities !== 'object') throw new Error();
      setPicked({ name: f.name, bundle });
    } catch {
      setParseError('这不是本应用导出的数据文件');
    }
  }

  const total = (r: ImportDataResult) =>
    Object.values(r.counts).reduce((s, c) => ({ created: s.created + (c?.created ?? 0), updated: s.updated + (c?.updated ?? 0), skipped: s.skipped + (c?.skipped ?? 0) }), { created: 0, updated: 0, skipped: 0 });

  return (
    <Card title="数据">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" icon={DownloadSimple} onClick={() => exp.mutate()} loading={exp.isPending}>导出全部数据</Button>
          <span className="text-xs text-ink-3">{exp.data ?? 'JSON 文件，含所有学习记录'}</span>
        </div>
        {exp.isError && <Notice tone="error">{errorText(exp.error)}</Notice>}

        <div className="border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="outline" icon={UploadSimple} onClick={() => file.current?.click()}>选择导入文件</Button>
            {picked && <span className="text-sm text-ink-2">{picked.name}</span>}
          </div>
          {parseError && <Notice tone="error" className="mt-3">{parseError}</Notice>}
          {picked && !imp.isSuccess && (
            <div className="mt-3 space-y-3">
              <Segmented label="导入方式" value={mode} onChange={setMode} options={[{ value: 'merge', label: '合并' }, { value: 'replace', label: '覆盖' }]} />
              <p className="text-sm text-ink-2">
                {mode === 'merge' ? '同一条记录只在文件里的版本更新时才覆盖，其余保留。' : '先清空现有学习数据（设置和内置句库除外），再按文件还原。'}
              </p>
              {mode === 'replace' && <Notice tone="warn"><Warning weight="fill" className="mr-1 inline size-4" />覆盖会删掉文件里没有的记录。不确定的话先导出一份当前数据。</Notice>}
              <Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={() => imp.mutate()} loading={imp.isPending}>开始导入</Button>
            </div>
          )}
          {imp.data && (() => {
            const t = total(imp.data);
            return <Notice tone="ok" className="mt-3">导入完成：新增 {t.created} · 更新 {t.updated} · 跳过 {t.skipped}</Notice>;
          })()}
          {imp.isError && <Notice tone="error" className="mt-3">{errorText(imp.error)}</Notice>}
        </div>

        <div className="flex items-start gap-3 border-t border-line pt-4 text-sm">
          <CloudCheck weight="duotone" className="mt-0.5 size-5 shrink-0" style={{ color: backup.data?.lastVerifyOk ? lineOf('phrases').color : 'var(--ink-3)' }} />
          {backup.data ? (
            <div className="text-ink-2">
              服务器每天自动备份并校验。上次备份 {fmtTime(backup.data.lastBackupAt)}
              {backup.data.lastBackupSizeBytes !== null && `（${fmtBytes(backup.data.lastBackupSizeBytes)}）`}
              ，{backup.data.lastVerifyOk === null ? '尚未校验' : backup.data.lastVerifyOk ? '恢复校验通过' : '恢复校验失败'}，保留 {backup.data.retainedCount} 份。
            </div>
          ) : (
            <div className="text-ink-3">{backup.isError ? '读不到备份状态' : '正在读取备份状态…'}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function AboutCard() {
  const health = useQuery({ queryKey: ['health'], queryFn: systemApi.health, staleTime: 60_000 });
  const h = health.data;
  const check = useMutation({ mutationFn: checkNow });
  const aiKey = useQuery({ queryKey: ['ai-key-status'], queryFn: aiKeyApi.status, staleTime: 60_000 });
  const AI_SOURCE = { own: '用您自己的 Key', shared: '共享额度', none: '还没有填 Key' } as const;
  const rows: Array<[string, string]> = [
    ['App', `v${__APP_VERSION__}（${{ web: '网页', android: '安卓', desktop: 'Windows' }[platform]}）`],
    ['服务端', h ? `v${h.version} · 契约 ${h.contractVersion}` : health.isError ? '无法连接' : '…'],
    ['数据库', h ? (h.db === 'ok' ? '正常' : '不可用') : '…'],
    ['AI 老师', aiKey.data ? AI_SOURCE[aiKey.data.source] : '…'],
  ];
  return (
    <Card title="关于">
      <dl className="grid grid-cols-[5rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {platform !== 'web' && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => check.mutate()} loading={check.isPending}>检查更新</Button>
          {check.data && <p className="text-sm text-ink-2">{check.data}</p>}
        </div>
      )}
    </Card>
  );
}
