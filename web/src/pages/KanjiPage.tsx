/**
 * 汉字：N5 字表（按正确率着色），点开看音训、部首、常用词；"读音"与"意思"两种小测，读音题服务端复核。
 */
import { CheckCircle, MagnifyingGlass, X, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState, type FormEvent } from 'react';
import type { Kanji } from '@shared/types';
import { kanjiApi } from '@/api/endpoints';
import { Button, Card, Input, Notice, PageHeader, Segmented, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, SpeakButton, useStudyTimer } from '@/lib/study';

const LINE = lineOf('kanji');

export function KanjiPage() {
  useStudyTimer('kanji');
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const [open, setOpen] = useState<Kanji | null>(null);
  const list = useQuery({ queryKey: ['kanji', dq], queryFn: () => kanjiApi.list({ q: dq || undefined }) });
  const items = list.data?.items ?? [];
  const learned = items.filter((k) => (k.progress.correctRate ?? 0) >= 0.8).length;

  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="汉字" subtitle={list.data ? `N5 · ${items.length} 字 · 掌握 ${learned}` : 'N5 汉字'} />
      <div className="relative mb-4">
        <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <Input lang="ja" value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入汉字或读音（如 みず）" className="pl-9" aria-label="查找汉字" />
      </div>
      {open && <Detail k={open} onClose={() => setOpen(null)} />}
      {list.isError ? (
        <Notice tone="error">{errorText(list.error)}</Notice>
      ) : !list.data ? (
        <Skeleton className="h-80" />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
          {items.map((k) => {
            const rate = k.progress.correctRate;
            return (
              <li key={k.id}>
                <button
                  onClick={() => setOpen(k)}
                  lang="ja"
                  aria-label={`${k.character}，${k.meaningsZh[0]}`}
                  className={cx('relative grid aspect-square w-full place-items-center rounded-xl bg-surface text-2xl font-bold lift transition hover:-translate-y-0.5', open?.id === k.id && 'ring-2 ring-ink/60')}
                >
                  {k.character}
                  {rate !== null && <span className="absolute inset-x-2 bottom-1.5 h-1 rounded-full" style={{ background: rate >= 0.8 ? LINE.color : 'var(--rail)' }} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Detail({ k, onClose }: { k: Kanji; onClose: () => void }) {
  const [mode, setMode] = useState<'info' | 'reading' | 'meaning'>('info');
  return (
    <Card className="mb-4" action={<button onClick={onClose} aria-label="关闭" className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-2"><X className="size-4" /></button>}
      title={<Segmented label="视图" value={mode} onChange={setMode} options={[{ value: 'info', label: '字卡' }, { value: 'reading', label: '读音测' }, { value: 'meaning', label: '意思测' }]} />}>
      {mode === 'info' ? (
        <div className="flex flex-wrap gap-5">
          <div lang="ja" className="grid size-28 shrink-0 place-items-center rounded-2xl bg-surface-2 text-7xl font-black">{k.character}</div>
          <div className="min-w-48 flex-1 space-y-1.5 text-sm">
            <div><span className="text-ink-3">音读　</span><span lang="ja" className="font-semibold">{k.onyomi.join('、') || '—'}</span></div>
            <div><span className="text-ink-3">训读　</span><span lang="ja" className="font-semibold">{k.kunyomi.join('、') || '—'}</span></div>
            <div><span className="text-ink-3">部首　</span><span lang="ja">{k.radical}</span><span className="ml-4 text-ink-3">画数　</span><span className="font-sign font-semibold">{k.strokeCount}</span></div>
            <div className="text-base font-bold">{k.meaningsZh.join('；')}</div>
            {k.progress.attempts > 0 && <div className="text-xs text-ink-3">练过 {k.progress.attempts} 次 · 正确率 {Math.round((k.progress.correctRate ?? 0) * 100)}%</div>}
          </div>
          <ul className="grid w-full gap-2 sm:grid-cols-2">
            {k.commonWords.map((w) => (
              <li key={w.word} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <div className="flex-1"><JaText text={w.word} reading={w.reading} mode="always" className="font-bold" /><div className="text-sm text-ink-3">{w.meaningZh}</div></div>
                <SpeakButton text={w.word} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Quiz key={`${k.id}-${mode}`} k={k} mode={mode} />
      )}
    </Card>
  );
}

function Quiz({ k, mode }: { k: Kanji; mode: 'reading' | 'meaning' }) {
  const qc = useQueryClient();
  const [answer, setAnswer] = useState('');
  const all = useQuery({ queryKey: ['kanji', ''], queryFn: () => kanjiApi.list() });
  const options = useMemo(() => {
    const others = (all.data?.items ?? []).filter((x) => x.id !== k.id).sort(() => Math.random() - 0.5).slice(0, 3).map((x) => x.meaningsZh[0]);
    return [k.meaningsZh[0], ...others].sort(() => Math.random() - 0.5);
  }, [all.data, k]);
  const record = useMutation({
    mutationFn: (v: { answer: string; correct: boolean }) => kanjiApi.record({ kanjiId: k.id, mode, ...v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanji'] }),
  });
  const r = record.data;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (answer.trim()) record.mutate({ answer: answer.trim(), correct: false });
  }
  return (
    <div>
      <div lang="ja" className="py-3 text-center text-6xl font-black">{k.character}</div>
      {mode === 'reading' ? (
        <form onSubmit={submit} className="flex gap-2">
          <Input lang="ja" autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!!r} placeholder="写一个读音（音读片假名或训读平假名都行）" aria-label="读音" />
          <Button type="submit" loading={record.isPending} disabled={!!r || !answer.trim()}>确定</Button>
        </form>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <button key={o} disabled={!!r} onClick={() => record.mutate({ answer: o, correct: o === k.meaningsZh[0] })}
              className={cx('min-h-11 rounded-xl px-3 text-left ring-1 ring-inset', r && o === k.meaningsZh[0] ? 'bg-go-soft ring-ok/50' : r && o === r.answer && !r.correct ? 'bg-danger-soft ring-danger/40' : 'ring-line hover:ring-rail')}>
              {o}
            </button>
          ))}
        </div>
      )}
      {r && (
        <p className={cx('mt-3 flex items-center gap-1.5 font-semibold', r.correct ? 'text-ok' : 'text-danger')}>
          {r.correct ? <CheckCircle weight="fill" className="size-5" /> : <XCircle weight="fill" className="size-5" />}
          {r.correct ? '正确' : <>答案：<span lang="ja">{mode === 'reading' ? [...k.onyomi, ...k.kunyomi].join('、') : k.meaningsZh.join('；')}</span></>}
        </p>
      )}
      {record.isError && <Notice tone="error" className="mt-2">{errorText(record.error)}</Notice>}
    </div>
  );
}
