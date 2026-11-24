/**
 * 听力：材料表 → 播放页。暂无音频，逐段用 TTS 朗读（契约 §9）。
 *   盲听：只听不看，最后自评理解程度
 *   字幕：边听边看原文
 *   精听：逐段看原文、读音、中文
 *   听写：每段听完写下来，即时逐字比对
 */
import { CheckCircle, Headphones, Play, Repeat, Stop } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ListeningMode } from '@shared/constants';
import type { DictationResult, ListeningMaterial } from '@shared/types';
import { listeningApi } from '@/api/endpoints';
import { DiffView } from '@/components/practice';
import { Button, Card, EmptyState, Input, Notice, PageHeader, Segmented, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, useSettingsData, useStudyTimer } from '@/lib/study';
import { speech } from '@/platform/speech';

const LINE = lineOf('listening');

export function ListeningPage() {
  useStudyTimer('listening');
  const list = useQuery({ queryKey: ['listening'], queryFn: () => listeningApi.materials() });
  const done = useQuery({ queryKey: ['listening-attempts'], queryFn: () => listeningApi.attempts({ limit: 100 }) });
  const practiced = new Set(done.data?.items.map((a) => a.materialId));
  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="听力" subtitle="四种模式，从盲听到听写" />
      {list.isError ? (
        <Notice tone="error">{errorText(list.error)}</Notice>
      ) : !list.data ? (
        <Skeleton className="h-64" />
      ) : (
        <ul className="stagger overflow-hidden rounded-2xl bg-surface lift">
          {list.data.items.map((m, i) => (
            <li key={m.id} className={i ? 'border-t border-line' : undefined}>
              <Link to={`/listening/${m.id}`} viewTransition className="flex min-h-16 items-center gap-3 px-4 hover:bg-surface-2/60">
                <span className="font-sign w-10 shrink-0 rounded-md bg-surface-2 py-0.5 text-center text-xs font-bold">{m.level}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{m.title}</div>
                  <div className="text-xs text-ink-3">{m.topic} · {m.segmentCount} 段</div>
                </div>
                {practiced.has(m.id) && <CheckCircle weight="fill" className="size-5" style={{ color: LINE.color }} aria-label="练过" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ListeningPlayerPage() {
  useStudyTimer('listening');
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['listening', id], queryFn: () => listeningApi.material(id) });
  return (
    <div>
      <PageHeader line={LINE} back="/listening" title={q.data?.title ?? '听力'} subtitle={q.data ? `${q.data.level} · ${q.data.topic}` : undefined} />
      {q.isError ? <Notice tone="error">{errorText(q.error)}</Notice> : !q.data ? <Skeleton className="h-72" /> : <Player m={q.data} />}
    </div>
  );
}

function Player({ m }: { m: ListeningMaterial }) {
  const settings = useSettingsData();
  const qc = useQueryClient();
  const [mode, setMode] = useState<ListeningMode>('subtitle');
  const [current, setCurrent] = useState<number | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const [replays, setReplays] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState<Record<number, DictationResult>>({});
  const [selfScore, setSelfScore] = useState(70);
  const stopRef = useRef(false);
  const startedAt = useRef(Date.now());

  useEffect(() => () => void speech.stop(), []);

  const say = async (i: number) => {
    setCurrent(i);
    await speech.speak(m.segments[i].text, { rate: settings?.speechRate ?? 1, voiceName: settings?.ttsVoice ?? null });
  };
  async function playAll() {
    stopRef.current = false;
    setPlayingAll(true);
    for (let i = 0; i < m.segments.length && !stopRef.current; i++) await say(i);
    setPlayingAll(false);
    setCurrent(null);
  }
  function stopAll() {
    stopRef.current = true;
    void speech.stop();
    setPlayingAll(false);
  }

  const check = useMutation({
    mutationFn: (i: number) => listeningApi.dictation(m.id, i, answers[i] ?? ''),
    onSuccess: (r) => setChecked((c) => ({ ...c, [r.segmentIndex]: r })),
  });
  const record = useMutation({
    mutationFn: () =>
      listeningApi.record({
        materialId: m.id,
        mode,
        durationMs: Date.now() - startedAt.current,
        replays,
        ...(mode === 'dictation'
          ? { dictationAnswers: Object.entries(answers).map(([index, answer]) => ({ index: Number(index), answer })) }
          : { score: selfScore }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['listening-attempts'] }),
  });

  const showText = mode === 'subtitle' || mode === 'intensive';
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="模式"
          value={mode}
          onChange={(v) => { setMode(v); record.reset(); }}
          options={[{ value: 'blind', label: '盲听' }, { value: 'subtitle', label: '字幕' }, { value: 'intensive', label: '精听' }, { value: 'dictation', label: '听写' }]}
        />
        {mode !== 'dictation' && (
          <Button icon={playingAll ? Stop : Play} variant={playingAll ? 'secondary' : 'primary'} onClick={() => (playingAll ? stopAll() : void playAll())}>
            {playingAll ? '停止' : '播放全部'}
          </Button>
        )}
      </div>

      <ol className="space-y-2">
        {m.segments.map((s) => {
          const r = checked[s.index];
          return (
            <li key={s.index} className={cx('rounded-2xl bg-surface p-4 lift transition-shadow', current === s.index && 'ring-2')} style={current === s.index ? { ['--tw-ring-color' as string]: LINE.color } : undefined}>
              <div className="flex items-start gap-3">
                <button
                  onClick={() => { setReplays((n) => n + 1); void say(s.index).then(() => setCurrent(null)); }}
                  aria-label={`播放第 ${s.index + 1} 段`}
                  className="grid size-10 shrink-0 place-items-center rounded-full text-white transition active:scale-95"
                  style={{ background: LINE.color }}
                >
                  {current === s.index ? <Repeat weight="bold" className="size-4" /> : <Play weight="fill" className="size-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  {showText ? (
                    <>
                      <JaText text={s.text} reading={s.reading} mode={mode === 'intensive' ? 'always' : settings?.furiganaMode} className="text-[17px] font-semibold leading-relaxed" />
                      {mode === 'intensive' && <div className="mt-1 text-sm text-ink-3">{s.zh}</div>}
                    </>
                  ) : mode === 'blind' ? (
                    <div className="py-2 text-sm text-ink-3">第 {s.index + 1} 段</div>
                  ) : (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        check.mutate(s.index);
                      }}
                    >
                      <Input lang="ja" value={answers[s.index] ?? ''} onChange={(e) => setAnswers({ ...answers, [s.index]: e.target.value })} placeholder="听到什么就写什么，假名也行" aria-label={`第 ${s.index + 1} 段听写`} />
                      <Button type="submit" variant="outline" loading={check.isPending && check.variables === s.index} disabled={!answers[s.index]?.trim()}>对答案</Button>
                    </form>
                  )}
                  {r && (
                    <div className="mt-3 rounded-xl bg-surface-2 p-3">
                      <div className="mb-1 text-xs font-semibold text-ink-3">准确度 <span className="font-sign text-base text-ink">{r.accuracy}%</span></div>
                      <DiffView diff={r.diff} />
                      <div lang="ja" className="mt-1 text-sm text-ink-2">原文：{r.expected}</div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Card className="mt-5" title="记下这次练习">
        {mode !== 'dictation' && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-ink-2">听懂了多少</span>
            <input type="range" min={0} max={100} step={10} value={selfScore} onChange={(e) => setSelfScore(Number(e.target.value))} className="w-48 accent-[var(--go)]" aria-label="理解程度" />
            <span className="font-sign text-lg font-bold">{selfScore}%</span>
          </div>
        )}
        {record.isSuccess ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-ok"><CheckCircle weight="fill" className="size-5" />已记录{record.data.score !== null && `，得分 ${record.data.score}`}</p>
        ) : (
          <Button onClick={() => record.mutate()} loading={record.isPending} disabled={mode === 'dictation' && !Object.keys(answers).length}>完成</Button>
        )}
        {record.isError && <Notice tone="error" className="mt-2">{errorText(record.error)}</Notice>}
      </Card>
      {!m.segments.length && <EmptyState icon={Headphones} title="这篇材料没有内容" />}
    </>
  );
}
