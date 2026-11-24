/**
 * 句库：旅行 / 生活两本，按场景分类；每句可听、可跟读打分、可收藏；也能加自己的句子。
 */
import { Heart, MagnifyingGlass, Plus, Quotes } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PhraseBook } from '@shared/constants';
import type { Phrase, PhraseAttempt } from '@shared/types';
import { phrasesApi } from '@/api/endpoints';
import { DiffView, Recorder, ScoreBars, type Take } from '@/components/practice';
import { Button, Card, EmptyState, Field, Input, Notice, PageHeader, Segmented, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, SpeakButton, useSettingsData, useStudyTimer } from '@/lib/study';
import { warmRecognizer } from '@/platform/recognizer';

const LINE = lineOf('phrases');

export function PhrasesPage() {
  useStudyTimer('phrases');
  useEffect(warmRecognizer, []);
  const [book, setBook] = useState<PhraseBook>('travel');
  const [category, setCategory] = useState<string>('');
  const [q, setQ] = useState('');
  const [fav, setFav] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['phrases', book], queryFn: () => phrasesApi.list({ book, limit: 100 }) });
  const all = list.data?.items ?? [];
  const categories = useMemo(() => [...new Set(all.map((p) => p.category))], [all]);
  const shown = all.filter(
    (p) => (!category || p.category === category) && (!fav || p.favorite) && (!q || p.ja.includes(q) || p.reading.includes(q) || p.zh.includes(q)),
  );

  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="句库" subtitle="听一遍，跟着读，看哪里没读准" actions={<Button size="sm" variant="outline" icon={Plus} onClick={() => setAdding((v) => !v)}>加句子</Button>} />
      {adding && <AddPhrase book={book} onDone={() => setAdding(false)} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="句库" value={book} onChange={(b) => { setBook(b); setCategory(''); }} options={[{ value: 'travel', label: '旅行' }, { value: 'life', label: '生活' }]} />
        <div className="relative min-w-40 flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜日文、读音或中文" className="pl-9" aria-label="搜索" />
        </div>
        <button onClick={() => setFav((v) => !v)} aria-pressed={fav} className={cx('flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-inset', fav ? 'bg-danger-soft text-danger ring-danger/30' : 'text-ink-2 ring-line')}>
          <Heart weight={fav ? 'fill' : 'regular'} className="size-4" /> 收藏
        </button>
      </div>
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {['', ...categories].map((c) => (
          <button key={c || '*'} onClick={() => setCategory(c)} className={cx('min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold', category === c ? 'bg-ink text-ground' : 'bg-surface text-ink-2 ring-1 ring-line')}>
            {c || '全部'}
          </button>
        ))}
      </div>

      {list.isError ? (
        <Notice tone="error">{errorText(list.error)}</Notice>
      ) : list.isPending ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !shown.length ? (
        <Card><EmptyState icon={Quotes} title="没有符合条件的句子" /></Card>
      ) : (
        <ul className="stagger space-y-2">{shown.map((p) => <PhraseRow key={p.id} p={p} />)}</ul>
      )}
    </div>
  );
}

function PhraseRow({ p }: { p: Phrase }) {
  const settings = useSettingsData();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<PhraseAttempt | null>(null);
  const favorite = useMutation({
    mutationFn: () => phrasesApi.update(p.id, p.version, { favorite: !p.favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['phrases'] }),
  });
  const attempt = useMutation({
    mutationFn: (t: Take) => phrasesApi.attempt(p.id, t as unknown as Record<string, unknown>),
    onSuccess: (a) => {
      setLast(a);
      void qc.invalidateQueries({ queryKey: ['phrases'] });
    },
  });

  return (
    <li className="rounded-2xl bg-surface lift">
      <div className="flex items-center gap-3 px-4 py-3">
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <JaText text={p.ja} reading={p.reading} mode={settings?.furiganaMode} className="text-[17px] font-bold" />
          <div className="text-sm text-ink-3">{p.zh}</div>
        </button>
        {p.bestScore !== null && (
          <span className="font-sign text-lg font-bold tabular" style={{ color: p.bestScore >= 80 ? LINE.color : 'var(--ink-3)' }} title={`最高分（练了 ${p.attemptCount} 次）`}>{p.bestScore}</span>
        )}
        <button onClick={() => favorite.mutate()} aria-label={p.favorite ? '取消收藏' : '收藏'} aria-pressed={p.favorite} className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-surface-2">
          <Heart weight={p.favorite ? 'fill' : 'regular'} className={cx('size-5', p.favorite && 'text-danger')} />
        </button>
        <SpeakButton text={p.ja} />
      </div>
      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          {p.note && <p className="mb-3 text-sm text-ink-2">{p.note}</p>}
          <Recorder onTake={(t) => attempt.mutate(t)} busy={attempt.isPending} />
          {attempt.isError && <Notice tone="error" className="mt-3">{errorText(attempt.error)}</Notice>}
          {last && (
            <div className="mt-4 space-y-3 rounded-xl bg-surface-2 p-3">
              <ScoreBars scores={last.scores} color={LINE.color} />
              {last.transcript && <DiffView diff={last.diff} />}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function AddPhrase({ book, onDone }: { book: PhraseBook; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ja: '', reading: '', zh: '', category: '自建' });
  const add = useMutation({
    mutationFn: () => phrasesApi.create({ book, ...f }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['phrases'] });
      onDone();
    },
  });
  const ok = f.ja.trim() && f.reading.trim() && f.zh.trim() && f.category.trim();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (ok) add.mutate();
  }
  return (
    <Card className="mb-5" title={`加到${book === 'travel' ? '旅行' : '生活'}句库`}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="日文"><Input lang="ja" autoFocus value={f.ja} onChange={(e) => setF({ ...f, ja: e.target.value })} maxLength={300} /></Field>
        <Field label="读音（全假名）" hint="跟读评分会按读音比对"><Input lang="ja" value={f.reading} onChange={(e) => setF({ ...f, reading: e.target.value })} maxLength={600} /></Field>
        <Field label="中文"><Input value={f.zh} onChange={(e) => setF({ ...f, zh: e.target.value })} maxLength={300} /></Field>
        <Field label="分类"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={40} /></Field>
        <div><Button type="submit" loading={add.isPending} disabled={!ok}>保存</Button></div>
        {add.isError && <Notice tone="error" className="sm:col-span-2">{errorText(add.error)}</Notice>}
      </form>
    </Card>
  );
}
