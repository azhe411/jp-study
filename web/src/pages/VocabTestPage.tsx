/**
 * 词汇量测试：60 题一题一屏。"认识吗"题凭感觉答；四选一题验证是不是真认识；
 * 里面混着不存在的假词 —— 说认识就会拉低可信度，所以不认识就大方点"不认识"。
 */
import { ArrowRight, ShootingStar, Timer } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { VocabTestResult, VocabTestStartResult } from '@shared/types';
import { vocabApi } from '@/api/endpoints';
import { HBar } from '@/components/charts';
import { Button, Card, EmptyState, Notice, PageHeader, Rail, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { useStudyTimer } from '@/lib/study';

const LINE = lineOf('vocabTest');
type Answer = { itemId: string; known?: boolean; choiceIndex?: number };

export function VocabTestPage() {
  useStudyTimer('vocabTest');
  const qc = useQueryClient();
  const [test, setTest] = useState<VocabTestStartResult | null>(null);
  const [result, setResult] = useState<VocabTestResult | null>(null);
  const history = useQuery({ queryKey: ['vocab-history'], queryFn: vocabApi.history });
  const start = useMutation({ mutationFn: vocabApi.start, onSuccess: (t) => { setTest(t); setResult(null); } });

  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="词汇量测试" subtitle="60 题，约 5 分钟。按词频分段抽样，估算词汇量与 JLPT 等级" />
      {test && !result ? (
        <Runner test={test} onDone={(r) => { setResult(r); setTest(null); void qc.invalidateQueries({ queryKey: ['vocab-history'] }); }} onAbort={() => setTest(null)} />
      ) : (
        <>
          {result && <ResultCard r={result} />}
          <Card className={result ? 'mt-4' : undefined}>
            <div className="flex flex-wrap items-center gap-4">
              <p className="flex-1 text-sm text-ink-2">有些词是编出来的假词。不确定就选"不认识"，结果反而更准。</p>
              <Button icon={ShootingStar} onClick={() => start.mutate()} loading={start.isPending}>{result ? '再测一次' : '开始测试'}</Button>
            </div>
            {start.isError && <Notice tone="error" className="mt-3">{errorText(start.error)}</Notice>}
          </Card>
          <h2 className="mb-2 mt-6 px-1 text-[15px] font-extrabold">历史</h2>
          {history.data?.items.length ? (
            <ul className="overflow-hidden rounded-2xl bg-surface lift">
              {history.data.items.map((h, i) => (
                <li key={h.id} className={cx('flex items-center gap-4 px-4 py-3', i > 0 && 'border-t border-line')}>
                  <span className="font-sign w-20 text-xl font-bold tabular">{h.estimatedVocab}</span>
                  <span className="font-sign rounded-md bg-surface-2 px-2 py-0.5 text-sm font-bold">{h.jlptEstimate}</span>
                  <span className="flex-1 text-right text-xs text-ink-3">误报率 {Math.round(h.falseAlarmRate * 100)}% · {new Date(h.createdAt).toLocaleDateString('zh-CN')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Card><EmptyState icon={ShootingStar} title="还没有测过" /></Card>
          )}
        </>
      )}
    </div>
  );
}

function Runner({ test, onDone, onAbort }: { test: VocabTestStartResult; onDone: (r: VocabTestResult) => void; onAbort: () => void }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const startedAt = useRef(Date.now());
  const submit = useMutation({ mutationFn: (a: Answer[]) => vocabApi.submit(test.testId, a, Date.now() - startedAt.current), onSuccess: onDone });
  const item = test.items[i];
  function answer(a: Answer) {
    const next = [...answers, a];
    setAnswers(next);
    if (i + 1 >= test.items.length) submit.mutate(next);
    else setI(i + 1);
  }
  return (
    <Card>
      <div className="mb-6 flex items-center gap-3">
        <Rail value={i / test.items.length} color={LINE.color} className="flex-1" label="测试进度" />
        <span className="font-sign text-sm font-semibold tabular text-ink-3">{i + 1}/{test.items.length}</span>
        <button onClick={onAbort} className="text-xs font-semibold text-ink-3 underline">放弃</button>
      </div>
      {submit.isPending ? (
        <p className="py-16 text-center text-ink-3"><Timer className="mr-1 inline size-4" />正在估算……</p>
      ) : item ? (
        <div key={item.itemId} className="animate-[rise-in_320ms_var(--ease-out-expo)]">
          <div lang="ja" className="py-8 text-center text-[clamp(32px,9vw,52px)] font-black">{item.word}</div>
          {item.kind === 'yesNo' ? (
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" variant="outline" onClick={() => answer({ itemId: item.itemId, known: false })}>不认识</Button>
              <Button size="lg" onClick={() => answer({ itemId: item.itemId, known: true })}>认识</Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {item.options!.map((o, oi) => (
                <button key={oi} onClick={() => answer({ itemId: item.itemId, choiceIndex: oi })} className="min-h-12 rounded-xl px-4 text-left ring-1 ring-inset ring-line transition hover:ring-rail active:scale-[0.98]">{o}</button>
              ))}
              <button onClick={() => answer({ itemId: item.itemId })} className="min-h-12 rounded-xl px-4 text-left text-ink-3 sm:col-span-2">不知道 <ArrowRight className="inline size-3.5" /></button>
            </div>
          )}
        </div>
      ) : null}
      {submit.isError && <Notice tone="error" className="mt-3">{errorText(submit.error)}</Notice>}
    </Card>
  );
}

function ResultCard({ r }: { r: VocabTestResult }) {
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <div className="text-xs font-semibold text-ink-3">估算词汇量</div>
          <div className="font-sign text-5xl font-bold leading-none tabular" style={{ color: LINE.color }}>{r.estimatedVocab}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink-3">大约相当于</div>
          <div className="font-sign text-3xl font-bold">{r.jlptEstimate}</div>
        </div>
        <div className="text-xs text-ink-3">假词误报率 {Math.round(r.falseAlarmRate * 100)}%{r.falseAlarmRate > 0.25 && '，偏高：下次不确定就选不认识'}</div>
      </div>
      <ul className="mt-5 space-y-2">
        {r.bands.map((b) => (
          <li key={b.upTo} className="flex items-center gap-3 text-sm">
            <span className="font-sign w-24 shrink-0 text-ink-3">前 {b.upTo} 词</span>
            <HBar value={b.knownRate} max={1} />
            <span className="font-sign w-10 text-right tabular">{Math.round(b.knownRate * 100)}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
