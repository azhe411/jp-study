/**
 * 复习：今天到期的抽认卡，一张一张翻。空格翻面，1–4 评分（重来 / 困难 / 良好 / 简单）。
 * 每张卡从亮出正面到评分的时长一并上报，供 FSRS 参考。
 */
import { ArrowClockwise, ArrowCounterClockwise, Cards, Confetti, FileArrowUp, ListBullets, Plus, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Card as CardT, CardInput } from '@shared/types';
import { cardsApi } from '@/api/endpoints';
import { Button, Card, EmptyState, Field, Input, Notice, PageHeader, Rail, Skeleton, Textarea, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, SpeakButton, useSettingsData, useStudyTimer } from '@/lib/study';

const LINE = lineOf('flashcards');

const RATINGS = [
  { rating: 1, label: '重来', key: '1', tone: 'bg-danger-soft text-danger' },
  { rating: 2, label: '困难', key: '2', tone: 'bg-surface-2 text-warn' },
  { rating: 3, label: '良好', key: '3', tone: 'bg-go-soft text-ok' },
  { rating: 4, label: '简单', key: '4', tone: 'bg-surface-2 text-[#0079c2] dark:text-[#5fb2ff]' },
] as const;

export function ReviewPage() {
  useStudyTimer('flashcards');
  const qc = useQueryClient();
  const [deck, setDeck] = useState<string | undefined>();
  const [panel, setPanel] = useState<'none' | 'add' | 'import'>('none');
  const decks = useQuery({ queryKey: ['decks'], queryFn: cardsApi.decks });
  const due = useQuery({ queryKey: ['due', deck], queryFn: () => cardsApi.due(deck), staleTime: 0 });

  return (
    <div>
      <PageHeader
        line={LINE}
        title="复习"
        subtitle={due.data ? `新卡 ${due.data.counts.new} · 学习中 ${due.data.counts.learning} · 到期 ${due.data.counts.review}` : '按遗忘曲线安排的今日复习'}
        actions={
          <>
            <Button variant="outline" size="sm" icon={Plus} onClick={() => setPanel(panel === 'add' ? 'none' : 'add')}>加卡</Button>
            <Button variant="ghost" size="sm" icon={FileArrowUp} onClick={() => setPanel(panel === 'import' ? 'none' : 'import')} className="hidden sm:inline-flex">导入</Button>
          </>
        }
      />

      {decks.data && decks.data.items.length > 1 && (
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {[{ deck: undefined as string | undefined, label: '全部牌组', due: decks.data.items.reduce((s, d) => s + d.due + d.new, 0) }, ...decks.data.items.map((d) => ({ deck: d.deck, label: d.deck, due: d.due + d.new }))].map((d) => (
            <button
              key={d.label}
              onClick={() => setDeck(d.deck)}
              className={cx('flex min-h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition', deck === d.deck ? 'bg-ink text-ground' : 'bg-surface text-ink-2 ring-1 ring-line hover:text-ink')}
            >
              {d.label}
              <span className="font-sign tabular opacity-70">{d.due}</span>
            </button>
          ))}
        </div>
      )}

      {panel === 'add' && <AddCard onDone={() => { setPanel('none'); void qc.invalidateQueries({ queryKey: ['due'] }); void qc.invalidateQueries({ queryKey: ['decks'] }); }} />}
      {panel === 'import' && <ImportCards onDone={() => { void qc.invalidateQueries({ queryKey: ['due'] }); void qc.invalidateQueries({ queryKey: ['decks'] }); }} onClose={() => setPanel('none')} />}

      {due.isError ? (
        <Notice tone="error">{errorText(due.error)}</Notice>
      ) : !due.data ? (
        <Skeleton className="mx-auto aspect-[4/3] max-w-xl rounded-3xl" />
      ) : (
        <Session key={deck ?? '*'} cards={due.data.items} onFinished={() => void qc.invalidateQueries({ queryKey: ['today'] })} />
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-x-6 text-center">
        <Link to="/review/restudy" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          <ArrowClockwise weight="bold" className="size-4" /> 重新学习（按天 / 按课）
        </Link>
        <Link to="/review/cards" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-3 hover:text-ink">
          <ListBullets weight="bold" className="size-4" /> 管理全部卡片
        </Link>
      </div>
    </div>
  );
}

/** 打乱出卡顺序：按加入顺序（あいうえお…）出卡，背着背着就能猜出下一张 */
function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Session({ cards, onFinished }: { cards: CardT[]; onFinished: () => void }) {
  const settings = useSettingsData();
  const [queue] = useState(() => shuffled(cards));
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<Record<number, number>>({});
  const shownAt = useRef(Date.now());
  const card = queue[i];

  const review = useMutation({
    mutationFn: ({ c, rating }: { c: CardT; rating: 1 | 2 | 3 | 4 }) => cardsApi.review(c.id, rating, Math.min(Date.now() - shownAt.current, 3_600_000)),
  });

  const rate = useCallback(
    (rating: 1 | 2 | 3 | 4) => {
      if (!card || !flipped || review.isPending) return;
      review.mutate(
        { c: card, rating },
        {
          onSuccess: () => {
            setTally((t) => ({ ...t, [rating]: (t[rating] ?? 0) + 1 }));
            setFlipped(false);
            shownAt.current = Date.now();
            setI((n) => n + 1);
            if (i + 1 >= queue.length) onFinished();
          },
        },
      );
    },
    [card, flipped, review, i, queue.length, onFinished],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key) as 1 | 2 | 3 | 4);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rate]);

  if (!queue.length) {
    return (
      <Card>
        <EmptyState icon={Cards} title="今天没有要复习的卡片">点右上角"加卡"，或从 AI 查询、阅读里把生词加进来。</EmptyState>
      </Card>
    );
  }
  if (!card) {
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    return (
      <Card>
        <EmptyState icon={Confetti} title={`今天的 ${total} 张都复习完了`}>
          {RATINGS.map((r) => `${r.label} ${tally[r.rating] ?? 0}`).join(' · ')}
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center gap-3">
        <Rail value={i / queue.length} color={LINE.color} className="flex-1" label="本轮进度" />
        <span className="font-sign text-sm font-semibold tabular text-ink-3">{i + 1}/{queue.length}</span>
      </div>

      <div className="flip-stage">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? '翻回正面' : '翻到背面'}
          data-flipped={flipped}
          className="flip-card relative grid aspect-[4/3] w-full text-left"
        >
          <div className="flip-face col-start-1 row-start-1 flex flex-col rounded-3xl bg-surface p-6 lift">
            <CardMeta card={card} />
            <div className="grid flex-1 place-items-center text-center">
              <JaText text={card.front} reading={card.reading} mode={settings?.furiganaMode === 'always' ? 'always' : 'never'} className="text-[clamp(28px,7vw,44px)] font-black leading-tight" />
            </div>
            <div className="text-center text-xs font-semibold text-ink-3">点一下或按空格翻面</div>
          </div>
          <div className="flip-face flip-back col-start-1 row-start-1 flex flex-col overflow-auto rounded-3xl bg-surface p-6 lift">
            <CardMeta card={card} />
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <JaText text={card.front} reading={card.reading} mode="always" className="text-2xl font-black" />
              <div className="text-lg font-semibold">{card.back}</div>
              {card.back === card.front && <div className="text-xs text-ink-3">和中文写法一样，记住读音就好</div>}
              {card.example && (
                <div className="mt-2 max-w-md rounded-xl bg-surface-2 px-4 py-3 text-left text-sm">
                  <div lang="ja" className="font-medium">{card.example}</div>
                  {card.exampleTranslation && <div className="mt-1 text-ink-3">{card.exampleTranslation}</div>}
                </div>
              )}
            </div>
          </div>
        </button>
      </div>

      <div className="mt-3 flex justify-center gap-2">
        <SpeakButton text={card.front} label="朗读正面" />
        {card.example && flipped && <SpeakButton text={card.example} label="朗读例句" />}
      </div>

      <div className={cx('mt-4 grid grid-cols-4 gap-2 transition-opacity duration-200', flipped ? 'opacity-100' : 'pointer-events-none opacity-30')} aria-hidden={!flipped}>
        {RATINGS.map((r) => (
          <button
            key={r.rating}
            onClick={() => rate(r.rating)}
            disabled={!flipped || review.isPending}
            className={cx('flex min-h-14 flex-col items-center justify-center rounded-2xl font-bold transition active:scale-95', r.tone)}
          >
            {r.label}
            <span className="font-sign text-[11px] opacity-60">{r.key}</span>
          </button>
        ))}
      </div>
      {review.isError && (
        <Notice tone="error" className="mt-3">
          {errorText(review.error)}
          <button className="ml-2 inline-flex items-center gap-1 underline" onClick={() => review.reset()}><ArrowCounterClockwise className="size-3.5" />再试</button>
        </Notice>
      )}
    </div>
  );
}

function CardMeta({ card }: { card: CardT }) {
  const state = { new: '新卡', learning: '学习中', review: '复习', relearning: '重学' }[card.srs.state];
  return (
    <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
      <span>{card.deck}</span>
      <span className="rounded-md px-1.5 py-0.5" style={{ background: `${LINE.color}22`, color: 'var(--ink-2)' }}>{state}</span>
    </div>
  );
}

/* ───────────── 加卡 / 导入 ───────────── */

function AddCard({ onDone }: { onDone: () => void }) {
  const settings = useSettingsData();
  const [f, setF] = useState({ front: '', reading: '', back: '', example: '', exampleTranslation: '', deck: '' });
  const add = useMutation({
    mutationFn: () =>
      cardsApi.create({
        front: f.front.trim(),
        back: f.back.trim(),
        reading: f.reading.trim() || null,
        example: f.example.trim() || null,
        exampleTranslation: f.exampleTranslation.trim() || null,
        deck: f.deck.trim() || undefined,
      }),
    onSuccess: () => {
      setF({ front: '', reading: '', back: '', example: '', exampleTranslation: '', deck: f.deck });
      onDone();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (f.front.trim() && f.back.trim()) add.mutate();
  }
  return (
    <Card className="mb-5" title="加一张卡">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="正面（日文）"><Input lang="ja" autoFocus value={f.front} onChange={set('front')} placeholder="食べる" maxLength={500} /></Field>
        <Field label="读音"><Input lang="ja" value={f.reading} onChange={set('reading')} placeholder="たべる" maxLength={500} /></Field>
        <Field label="背面（释义）" className="sm:col-span-2"><Input value={f.back} onChange={set('back')} placeholder="吃" maxLength={2000} /></Field>
        <Field label="例句（可选）"><Input lang="ja" value={f.example} onChange={set('example')} maxLength={1000} /></Field>
        <Field label="例句翻译（可选）"><Input value={f.exampleTranslation} onChange={set('exampleTranslation')} maxLength={1000} /></Field>
        <Field label="牌组" hint={`留空则放进"${settings?.defaultDeck ?? '默认'}"`}><Input value={f.deck} onChange={set('deck')} maxLength={60} /></Field>
        <div className="flex items-end gap-2">
          <Button type="submit" loading={add.isPending} disabled={!f.front.trim() || !f.back.trim()}>保存</Button>
          {add.isSuccess && <span className="pb-3 text-sm text-ok">已保存，可以接着加</span>}
        </div>
        {add.isError && <Notice tone="error" className="sm:col-span-2">{errorText(add.error)}</Notice>}
      </form>
    </Card>
  );
}

function ImportCards({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [deck, setDeck] = useState('导入');
  const [raw, setRaw] = useState('');
  const parsed = useMemo(() => parseCards(raw), [raw]);
  const imp = useMutation({ mutationFn: () => cardsApi.import({ deck, cards: parsed.cards }), onSuccess: onDone });
  return (
    <Card className="mb-5" title="批量导入" action={<button onClick={onClose} aria-label="关闭" className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-2"><X className="size-4" /></button>}>
      <p className="mb-3 text-sm text-ink-3">每行一张：<code className="rounded bg-surface-2 px-1">正面 [Tab] 背面 [Tab] 读音</code>，或粘贴 JSON 数组。同一牌组里正面相同的会跳过。</p>
      <div className="grid gap-3">
        <Field label="牌组"><Input value={deck} onChange={(e) => setDeck(e.target.value)} maxLength={60} /></Field>
        <Textarea lang="ja" rows={6} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'食べる\t吃\tたべる\n飲む\t喝\tのむ'} />
        <div className="flex items-center gap-3">
          <Button onClick={() => imp.mutate()} loading={imp.isPending} disabled={!parsed.cards.length || !deck.trim()}>导入 {parsed.cards.length} 张</Button>
          {parsed.error && <span className="text-sm text-danger">{parsed.error}</span>}
          {imp.data && <span className="text-sm text-ok">新增 {imp.data.created} · 跳过 {imp.data.skipped}</span>}
        </div>
        {imp.isError && <Notice tone="error">{errorText(imp.error)}</Notice>}
      </div>
    </Card>
  );
}

function parseCards(raw: string): { cards: CardInput[]; error?: string } {
  const text = raw.trim();
  if (!text) return { cards: [] };
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text) as CardInput[];
      if (!Array.isArray(arr) || arr.some((c) => !c?.front || !c?.back)) return { cards: [], error: 'JSON 里每张卡都要有 front 和 back' };
      return { cards: arr.slice(0, 2000) };
    } catch {
      return { cards: [], error: 'JSON 格式不对' };
    }
  }
  const cards = text
    .split(/\r?\n/)
    .map((l) => l.split(/\t|\s{2,}|,|，/).map((x) => x.trim()))
    .filter((p) => p[0] && p[1])
    .map(([front, back, reading]) => ({ front, back, reading: reading || null }));
  return { cards: cards.slice(0, 2000) };
}
