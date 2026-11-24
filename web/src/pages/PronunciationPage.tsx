/**
 * 发音：最小对立对。听辨模式随机念其中一个，选出听到的是哪个；开口模式指定一个，读给识别器听。
 */
import { CheckCircle, Ear, Microphone, Play, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PRONUNCIATION_CATEGORIES, type PronunciationCategory } from '@shared/constants';
import type { PronunciationAttempt, PronunciationPair } from '@shared/types';
import { pronunciationApi } from '@/api/endpoints';
import { Recorder, type Take } from '@/components/practice';
import { Button, Notice, PageHeader, Segmented, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { useSettingsData, useStudyTimer } from '@/lib/study';
import { warmRecognizer } from '@/platform/recognizer';
import { speech } from '@/platform/speech';

const LINE = lineOf('pronunciation');
const CAT_ZH: Record<PronunciationCategory, string> = {
  longVowel: '长音', sokuon: '促音', hatsuon: '拨音', dakuon: '浊音', youon: '拗音', pitchAccent: '音高', other: '其他',
};

export function PronunciationPage() {
  useStudyTimer('pronunciation');
  useEffect(warmRecognizer, []);
  const [cat, setCat] = useState<PronunciationCategory>('longVowel');
  const [mode, setMode] = useState<'listen' | 'speak'>('listen');
  const q = useQuery({ queryKey: ['pairs'], queryFn: () => pronunciationApi.pairs() });
  const pairs = q.data?.items.filter((p) => p.category === cat) ?? [];
  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="发音" subtitle="一对只差一个音的词：先练耳朵分得清，再练嘴巴读得准" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="模式" value={mode} onChange={setMode} options={[{ value: 'listen', label: '听辨' }, { value: 'speak', label: '开口' }]} />
      </div>
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {PRONUNCIATION_CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cx('min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold', cat === c ? 'bg-ink text-ground' : 'bg-surface text-ink-2 ring-1 ring-line')}>{CAT_ZH[c]}</button>
        ))}
      </div>
      {q.isError ? <Notice tone="error">{errorText(q.error)}</Notice> : !q.data ? <Skeleton className="h-64" /> : (
        <ul className="stagger space-y-3">{pairs.map((p) => <PairCard key={`${p.id}-${mode}`} p={p} mode={mode} />)}</ul>
      )}
    </div>
  );
}

function PairCard({ p, mode }: { p: PronunciationPair; mode: 'listen' | 'speak' }) {
  const settings = useSettingsData();
  const [target, setTarget] = useState<'a' | 'b'>(() => (Math.random() < 0.5 ? 'a' : 'b'));
  const [result, setResult] = useState<PronunciationAttempt | null>(null);
  const record = useMutation({ mutationFn: (b: Record<string, unknown>) => pronunciationApi.record({ pairId: p.id, mode, target, ...b }), onSuccess: setResult });
  const say = (s: 'a' | 'b') => void speech.speak(p[s].text === p[s].reading ? p[s].text : p[s].text, { rate: (settings?.speechRate ?? 1) * 0.9, voiceName: settings?.ttsVoice ?? null });
  const next = () => {
    setResult(null);
    setTarget(Math.random() < 0.5 ? 'a' : 'b');
  };

  return (
    <li className="rounded-2xl bg-surface p-4 lift">
      <div className="grid grid-cols-2 gap-2">
        {(['a', 'b'] as const).map((s) => {
          const chosen = result?.chosen === s;
          const right = result && s === result.target;
          return (
            <button
              key={s}
              disabled={mode === 'listen' ? !!result || record.isPending : false}
              onClick={() => (mode === 'listen' ? record.mutate({ chosen: s }) : (setTarget(s), setResult(null)))}
              className={cx(
                'flex min-h-20 flex-col items-center justify-center rounded-xl px-2 ring-1 ring-inset transition',
                result && right ? 'bg-go-soft ring-ok/50' : result && chosen ? 'bg-danger-soft ring-danger/40' : mode === 'speak' && target === s ? 'ring-2 ring-ink/60' : 'ring-line hover:ring-rail',
              )}
            >
              <span lang="ja" className="text-2xl font-black">{p[s].text}</span>
              <span lang="ja" className="text-xs text-ink-3">{p[s].reading} · {p[s].meaningZh}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {mode === 'listen' ? (
          <>
            <Button size="sm" icon={Ear} onClick={() => say(target)}>听一遍</Button>
            <span className="text-sm text-ink-3">{result ? '' : '听到的是哪一个？'}</span>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" icon={Play} onClick={() => say(target)}>示范</Button>
            <span className="text-sm text-ink-3">读出框起来的那个</span>
          </>
        )}
        {result && (
          <span className={cx('flex items-center gap-1.5 text-sm font-semibold', result.correct ? 'text-ok' : 'text-danger')}>
            {result.correct ? <CheckCircle weight="fill" className="size-5" /> : <XCircle weight="fill" className="size-5" />}
            {result.correct ? '对了' : mode === 'listen' ? `其实是「${p[result.target].text}」` : `识别成了「${result.transcript || '（没听清）'}」`}
          </span>
        )}
        {result && <Button size="sm" variant="ghost" onClick={next}>再来</Button>}
      </div>

      {mode === 'speak' && !result && (
        <div className="mt-3 border-t border-line pt-3">
          <Recorder onTake={(t: Take) => record.mutate({ transcript: t.transcript, method: t.method })} busy={record.isPending} />
        </div>
      )}
      {result && !result.correct && <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2"><Microphone className="mr-1 inline size-4" />{p.tip}</p>}
      {record.isError && <Notice tone="error" className="mt-2">{errorText(record.error)}</Notice>}
    </li>
  );
}
