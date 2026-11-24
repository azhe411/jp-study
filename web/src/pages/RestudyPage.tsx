/**
 * 重新学习（契约 v1.9.0）：复习是按遗忘曲线排的，评过分的卡要过几天才会再出现。
 * 想现在再过一遍时来这里：选某一天学过的卡，或者某一站的卡，翻卡自测。
 * 只是自己练，不改变复习进度 —— 不会打乱遗忘曲线排好的日程。
 * 每轮按"第一次翻到就记住"的比例打分并存到服务端（v1.10.0）：主页的建议靠它核验，还没记牢的卡靠它下榜。
 */
import { ArrowClockwise, CalendarBlank, Cards, CheckCircle, Train, Warning, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Card as CardT, RestudyGroups } from '@shared/types';
import { cardsApi } from '@/api/endpoints';
import { Button, Card, EmptyState, Notice, PageHeader, Segmented, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, SpeakButton, useStudyTimer } from '@/lib/study';

type Pick = { kind: 'date' | 'lesson' | 'hard'; value: string; label: string };

/** 这个分数以上算过关：和服务端核验用的一样 */
const PASS = 70;

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const dayLabel = (iso: string) => `${Number(iso.slice(5, 7))} 月 ${Number(iso.slice(8))} 日`;

export function RestudyPage() {
  useStudyTimer('flashcards');
  const [pick, setPick] = useState<Pick | null>(null);
  return (
    <div>
      <PageHeader back="/review" line={lineOf('flashcards')} title="重新学习" subtitle="把学过的卡再过一遍，每轮有成绩；不影响复习安排" />
      {pick ? <Session pick={pick} onBack={() => setPick(null)} /> : <Groups onPick={setPick} />}
    </div>
  );
}

function Groups({ onPick }: { onPick: (p: Pick) => void }) {
  const [tab, setTab] = useState<'date' | 'lesson'>('date');
  const q = useQuery<RestudyGroups>({ queryKey: ['restudy'], queryFn: cardsApi.restudyGroups, staleTime: 0 });
  // 主页建议点进来时直接开始那一组；地址上的参数用完就清掉，这样"换一组"退回来看到的是列表
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!q.data || (!params.has('lesson') && !params.has('hard'))) return;
    setParams({}, { replace: true });
    const lesson = params.get('lesson');
    const l = lesson ? q.data.lessons.find((x) => x.lessonId === lesson) : undefined;
    if (l) onPick({ kind: 'lesson', value: l.lessonId, label: `第 ${l.order} 站 · ${l.title}` });
    else if (params.get('hard') && q.data.hard?.count) onPick({ kind: 'hard', value: 'hard', label: '还没记牢的卡' });
  }, [q.data, params, setParams, onPick]);
  if (q.isError) return <Notice tone="error">{errorText(q.error)}</Notice>;
  if (!q.data) return <Skeleton className="h-64" />;
  const rows: Array<Pick & { count: number; lastScore?: number | null }> =
    tab === 'date'
      ? q.data.days.map((d) => ({ kind: 'date', value: d.date, label: dayLabel(d.date), count: d.count, lastScore: d.lastScore }))
      : q.data.lessons.map((l) => ({ kind: 'lesson', value: l.lessonId, label: `第 ${l.order} 站 · ${l.title}`, count: l.count, lastScore: l.lastScore }));
  const hard = q.data.hard;
  return (
    <>
      {hard && hard.count > 0 && (
        <button type="button" onClick={() => onPick({ kind: 'hard', value: 'hard', label: '还没记牢的卡' })} className="mb-4 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-surface px-4 py-2.5 text-left lift transition-colors hover:bg-surface-2">
          <Warning weight="duotone" className="size-5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">还没记牢的卡</span>
            <span className="block text-xs text-ink-3">第一次翻到就记住，就会从这里下来</span>
          </span>
          <span className="font-sign shrink-0 text-sm tabular text-ink-3">{hard.lastScore != null && `上次 ${hard.lastScore} 分 · `}{hard.count} 张</span>
        </button>
      )}
      <Segmented label="分组方式" value={tab} onChange={setTab} className="mb-4" options={[{ value: 'date', label: '按学习日' }, { value: 'lesson', label: '按课程' }]} />
      {!rows.length ? (
        <Card>
          <EmptyState icon={Cards} title={tab === 'date' ? '还没有学过的卡' : '还没有课程词卡'} action={<Link to="/review" className="font-semibold underline">去复习</Link>}>
            {tab === 'date' ? '在「复习」里学过的新卡，会按学习的日期出现在这里。' : '学到哪一课，那一课的词卡就会出现在这里。'}
          </EmptyState>
        </Card>
      ) : (
        <ul className="stagger overflow-hidden rounded-2xl bg-surface lift">
          {rows.map((r, i) => (
            <li key={r.value} className={i ? 'border-t border-line' : undefined}>
              <button type="button" onClick={() => onPick(r)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2">
                {tab === 'date' ? <CalendarBlank weight="duotone" className="size-5 shrink-0 text-ink-3" /> : <Train weight="duotone" className="size-5 shrink-0 text-ink-3" />}
                <span className="min-w-0 flex-1 truncate font-semibold">{r.label}</span>
                <span className="font-sign shrink-0 text-sm tabular text-ink-3">{r.lastScore != null && `上次 ${r.lastScore} 分 · `}{r.count} 张</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Session({ pick, onBack }: { pick: Pick; onBack: () => void }) {
  const q = useQuery({
    queryKey: ['restudy', pick.kind, pick.value, 'noPersist'],
    queryFn: () => cardsApi.restudyItems(pick.kind === 'date' ? { date: pick.value } : pick.kind === 'lesson' ? { lessonId: pick.value } : { hard: true }),
    staleTime: Infinity,
    gcTime: 0,
  });
  if (q.isError) return <Notice tone="error">{errorText(q.error)}</Notice>;
  if (!q.data) return <Skeleton className="mx-auto aspect-[4/3] max-w-xl rounded-3xl" />;
  return <Round key={pick.value} pick={pick} all={q.data.items} onBack={onBack} />;
}

/** 一轮翻卡：「还不会」的排到队尾，这一轮里再见一次；全部记住才算结束 */
function Round({ pick, all, onBack }: { pick: Pick; all: CardT[]; onBack: () => void }) {
  const title = pick.label;
  const [source, setSource] = useState(all);
  const [run, setRun] = useState(0);
  const first = useMemo(() => shuffled(source), [source, run]);
  const [queue, setQueue] = useState(first);
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState<Map<string, CardT>>(new Map());
  const [done, setDone] = useState(0);
  const [partial, setPartial] = useState(false);
  const card = queue[0];
  const save = useMutation({
    mutationFn: () =>
      cardsApi.restudyRound({
        scope: pick.kind,
        value: pick.kind === 'hard' ? null : pick.value,
        partial,
        results: source.map((c) => ({ cardId: c.id, known: !missed.has(c.id) })),
      }),
  });
  // 翻完一轮就交成绩
  const finished = source.length > 0 && !card;
  useEffect(() => {
    if (finished && save.isIdle) save.mutate();
  }, [finished, save]);

  const restart = (cards: CardT[], onlyMissed: boolean) => {
    save.reset();
    setPartial(onlyMissed);
    setSource(cards);
    setRun(run + 1);
    setQueue(shuffled(cards));
    setMissed(new Map());
    setDone(0);
    setFlipped(false);
  };

  const answer = (known: boolean) => {
    setFlipped(false);
    if (known) {
      setDone(done + 1);
      setQueue(queue.slice(1));
    } else {
      setMissed(new Map(missed).set(card.id, card));
      // 隔几张再出现，而不是下一张就是它
      const rest = queue.slice(1);
      const at = Math.min(rest.length, 4);
      setQueue([...rest.slice(0, at), card, ...rest.slice(at)]);
    }
  };

  if (!source.length) return <Card><EmptyState icon={Cards} title="这一组没有卡片">可能都被删掉了。</EmptyState></Card>;

  if (!card) {
    const hard = [...missed.values()];
    const score = Math.round(((source.length - hard.length) / source.length) * 100);
    const prev = save.data?.previousScore;
    return (
      <Card>
        <div className="pt-4 text-center">
          <p className={cx('font-sign text-6xl font-bold tabular', score >= PASS ? 'text-ok' : 'text-danger')}>{score}<span className="ml-1 text-xl">分</span></p>
          <p className="mt-1 text-sm text-ink-3">{score >= PASS ? '过关' : `${PASS} 分才算过关`}{!partial && prev != null && ` · 上次 ${prev} 分`}{partial && ' · 只练错题，不计入这一组的分数'}</p>
        </div>
        <EmptyState icon={CheckCircle} title={`${title}：${source.length} 张都过了一遍`}>
          {hard.length ? `其中 ${hard.length} 张第一次没记住。` : '全部一次记住。……勉强及格。'}
          {save.data && save.data.hardLeft > 0 && ` 还没记牢的卡还剩 ${save.data.hardLeft} 张。`}
        </EmptyState>
        {save.isError && (
          <Notice tone="error" className="mb-3">
            成绩没存上，主页的建议核验不到这一轮。{errorText(save.error)}
            <button type="button" className="ml-2 font-semibold underline" onClick={() => save.mutate()}>重试</button>
          </Notice>
        )}
        <div className="flex flex-wrap justify-center gap-2 pb-2">
          {hard.length > 0 && <Button icon={ArrowClockwise} onClick={() => restart(hard, true)}>只练没记住的 {hard.length} 张</Button>}
          <Button variant={hard.length ? 'outline' : 'primary'} onClick={() => restart(all, false)}>全部再来一遍</Button>
          <Button variant="ghost" onClick={onBack}>换一组</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center justify-between gap-3 text-sm text-ink-3">
        <button type="button" onClick={onBack} className="min-h-9 min-w-0 truncate font-semibold hover:text-ink">← {title}</button>
        <span className="font-sign shrink-0 tabular">{done}/{source.length}</span>
      </div>
      <button
        type="button"
        onClick={() => setFlipped(!flipped)}
        aria-label={flipped ? '翻回正面' : '翻面看答案'}
        className="flex min-h-64 w-full flex-col items-center justify-center gap-3 rounded-3xl bg-surface p-6 text-center lift"
      >
        <JaText text={card.front} reading={card.reading} mode={flipped ? 'always' : 'never'} className={cx('font-black leading-tight', flipped ? 'text-2xl' : 'text-[clamp(28px,7vw,44px)]')} />
        {flipped ? (
          <>
            <span className="text-lg font-semibold">{card.back}</span>
            {card.back === card.front && <span className="text-xs text-ink-3">和中文写法一样，记住读音就好</span>}
            {card.example && (
              <span className="mt-1 block max-w-md rounded-xl bg-surface-2 px-4 py-3 text-left text-sm">
                <span lang="ja" className="block font-medium">{card.example}</span>
                {card.exampleTranslation && <span className="mt-1 block text-ink-3">{card.exampleTranslation}</span>}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs font-semibold text-ink-3">点一下翻面</span>
        )}
      </button>
      <div className="mt-3 flex justify-center gap-2">
        <SpeakButton text={card.front} label="朗读正面" />
        {card.example && flipped && <SpeakButton text={card.example} label="朗读例句" />}
      </div>
      <div className={cx('mt-4 grid grid-cols-2 gap-2 transition-opacity', !flipped && 'pointer-events-none opacity-40')}>
        <Button variant="outline" size="lg" icon={XCircle} onClick={() => answer(false)} disabled={!flipped}>还不会</Button>
        <Button size="lg" icon={CheckCircle} onClick={() => answer(true)} disabled={!flipped}>记住了</Button>
      </div>
    </div>
  );
}
