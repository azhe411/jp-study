/**
 * 敬语 / 惯用语：先看条目，再做三种练习 ——
 *   意思：看表达选中文意思；转换：给普通形写敬语（仅敬语）；填空：例句里挖掉表达。
 * 转换与填空由服务端复核；答错自动进错题本。
 */
import { CheckCircle, Shuffle, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { ExpressionDrillMode, ExpressionType, IdiomKind, KeigoKind } from '@shared/constants';
import type { ExpressionAttempt, ExpressionItem } from '@shared/types';
import { expressionsApi } from '@/api/endpoints';
import { Button, Card, Input, Notice, PageHeader, Segmented, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, SpeakButton, useSettingsData, useStudyTimer } from '@/lib/study';

const KIND_ZH: Record<KeigoKind | IdiomKind, string> = {
  sonkeigo: '尊敬语', kenjougo: '谦让语', teineigo: '丁宁语', kanyouku: '惯用句', yojijukugo: '四字熟语', kotowaza: '谚语', onomatopoeia: '拟声拟态',
};

const shuffle = <T,>(xs: T[]) => [...xs].sort(() => Math.random() - 0.5);

export function ExpressionsPage() {
  const { type = '' } = useParams();
  if (type !== 'keigo' && type !== 'idiom') return <Navigate to="/practice" replace />;
  return <Expressions key={type} type={type} />;
}

function Expressions({ type }: { type: ExpressionType }) {
  const line = lineOf(type);
  useStudyTimer(type);
  const [tab, setTab] = useState<'list' | 'drill'>('list');
  const q = useQuery({ queryKey: ['expressions', type], queryFn: () => expressionsApi.items({ type }) });
  const items = q.data?.items ?? [];
  const kinds = [...new Set(items.map((i) => i.kind))];
  return (
    <div>
      <PageHeader line={line} back="/practice" title={line.name} subtitle={line.blurb} actions={<Segmented label="视图" value={tab} onChange={setTab} options={[{ value: 'list', label: '条目' }, { value: 'drill', label: '练习' }]} />} />
      {q.isError ? (
        <Notice tone="error">{errorText(q.error)}</Notice>
      ) : !q.data ? (
        <Skeleton className="h-72" />
      ) : tab === 'list' ? (
        <div className="space-y-5">
          {kinds.map((k) => (
            <section key={k}>
              <h2 className="mb-2 px-1 text-[15px] font-extrabold">{KIND_ZH[k]}</h2>
              <ul className="grid gap-2 sm:grid-cols-2">{items.filter((i) => i.kind === k).map((i) => <ItemCard key={i.id} i={i} />)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <Drill items={items} type={type} />
      )}
    </div>
  );
}

function ItemCard({ i }: { i: ExpressionItem }) {
  const settings = useSettingsData();
  return (
    <li className="rounded-2xl bg-surface p-4 lift">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <JaText text={i.expression} reading={i.reading} mode="always" className="text-xl font-black" />
          <div className="mt-0.5 font-semibold">{i.meaningZh}{i.plainForm && <span className="ml-2 text-sm font-normal text-ink-3">← <span lang="ja">{i.plainForm}</span></span>}</div>
        </div>
        <SpeakButton text={i.expression} />
      </div>
      <p className="mt-2 text-sm text-ink-2">{i.usageNote}</p>
      {i.examples[0] && (
        <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <JaText text={i.examples[0].ja} reading={i.examples[0].reading} mode={settings?.furiganaMode} className="font-medium" />
          <div className="text-ink-3">{i.examples[0].zh}</div>
        </div>
      )}
    </li>
  );
}

function Drill({ items, type }: { items: ExpressionItem[]; type: ExpressionType }) {
  const modes: ExpressionDrillMode[] = type === 'keigo' ? ['meaning', 'convert', 'fillBlank'] : ['meaning', 'fillBlank'];
  const [mode, setMode] = useState<ExpressionDrillMode>('meaning');
  const [deck, setDeck] = useState(() => shuffle(items));
  const [i, setI] = useState(0);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const item = deck[i % deck.length];
  const next = () => setI((n) => n + 1);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented label="题型" value={mode} onChange={(m) => { setMode(m); setDeck(shuffle(items)); setI(0); }} options={modes.map((m) => ({ value: m, label: { meaning: '意思', convert: '转换', fillBlank: '填空' }[m] }))} />
        <span className="font-sign text-sm font-semibold text-ink-3">{score.right}/{score.total}</span>
        <Button size="sm" variant="ghost" icon={Shuffle} onClick={() => { setDeck(shuffle(items)); setI(0); }}>换一批</Button>
      </div>
      {item && <Question key={`${item.id}-${mode}-${i}`} item={item} items={items} mode={mode} onDone={(ok) => setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))} onNext={next} />}
    </div>
  );
}

function Question({ item, items, mode, onDone, onNext }: { item: ExpressionItem; items: ExpressionItem[]; mode: ExpressionDrillMode; onDone: (ok: boolean) => void; onNext: () => void }) {
  const [answer, setAnswer] = useState('');
  const options = useMemo(() => shuffle([item.meaningZh, ...shuffle(items.filter((x) => x.id !== item.id)).slice(0, 3).map((x) => x.meaningZh)]), [item, items]);
  const record = useMutation({
    mutationFn: (v: { answer: string; correct: boolean }) => expressionsApi.record({ itemId: item.id, mode, ...v }),
    onSuccess: (r: ExpressionAttempt) => onDone(r.correct),
  });
  const ex = item.examples[0];
  const prompt =
    mode === 'meaning' ? <JaText text={item.expression} reading={item.reading} mode="never" className="text-3xl font-black" />
      : mode === 'convert' ? <div><div className="text-sm text-ink-3">换成{KIND_ZH[item.kind]}</div><div lang="ja" className="text-3xl font-black">{item.plainForm}</div><div className="mt-1 text-sm text-ink-3">{item.meaningZh}</div></div>
        : <div><div lang="ja" className="text-xl font-bold leading-relaxed">{ex ? ex.ja.replace(item.expression, '＿＿＿') : '＿＿＿'}</div><div className="mt-1 text-sm text-ink-3">{ex?.zh ?? item.meaningZh}</div></div>;

  function submitTyped(e: FormEvent) {
    e.preventDefault();
    const a = answer.trim();
    if (!a) return;
    record.mutate({ answer: a, correct: a === item.expression || a === item.reading });
  }

  const r = record.data;
  return (
    <Card>
      <div className="py-4 text-center">{prompt}</div>
      {mode === 'meaning' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const right = r && o === item.meaningZh;
            const wrong = r && !r.correct && o === r.answer;
            return (
              <button key={o} disabled={!!r || record.isPending} onClick={() => record.mutate({ answer: o, correct: o === item.meaningZh })}
                className={cx('min-h-12 rounded-xl px-3 text-left ring-1 ring-inset', right ? 'bg-go-soft ring-ok/50' : wrong ? 'bg-danger-soft ring-danger/40' : 'ring-line hover:ring-rail')}>
                {o}
              </button>
            );
          })}
        </div>
      ) : (
        <form onSubmit={submitTyped} className="flex gap-2">
          <Input lang="ja" autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!!r} placeholder="写出表达（假名也行）" aria-label="作答" />
          <Button type="submit" loading={record.isPending} disabled={!!r || !answer.trim()}>确定</Button>
        </form>
      )}
      {r && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3">
          <span className={cx('flex items-center gap-1.5 font-semibold', r.correct ? 'text-ok' : 'text-danger')}>
            {r.correct ? <CheckCircle weight="fill" className="size-5" /> : <XCircle weight="fill" className="size-5" />}
            {r.correct ? '正确' : <>答案：<span lang="ja">{mode === 'meaning' ? item.meaningZh : item.expression}</span></>}
          </span>
          <span className="flex-1 text-sm text-ink-2">{item.usageNote}</span>
          <Button size="sm" onClick={onNext}>下一题</Button>
        </div>
      )}
      {record.isError && <Notice tone="error" className="mt-2">{errorText(record.error)}</Notice>}
    </Card>
  );
}
