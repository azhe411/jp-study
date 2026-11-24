/**
 * 开口练习的公共部件：
 *   Recorder   —— 识别可用时录音，不可用时改为打字比对或自评（契约 §12.4：只降级、不报错）
 *   DiffView   —— 逐字对比：缺漏、多读、读错分别标色
 *   ScoreBars  —— 准确 / 完整 / 流利 / 综合
 */
import { DownloadSimple, Keyboard, Microphone, Stop } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { RecognitionMethod } from '@shared/constants';
import type { DiffSegment, SpeechScores } from '@shared/types';
import { MODEL_MB, loadModel, modelDownloaded } from '@/platform/recognizer';
import { recognizerChoice, speech, type Listening } from '@/platform/speech';
import { Button, Input, Notice, Segmented, Spinner, cx } from './ui';

export interface Take {
  transcript: string;
  method: RecognitionMethod;
  durationMs: number;
  selfScore?: number;
}

/** 识别能力只探测一次 */
let recognitionProbe: Promise<boolean> | null = null;
export function useRecognitionAvailable() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    recognitionProbe ??= speech.recognitionAvailable();
    let alive = true;
    void recognitionProbe.then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

/**
 * 网页端第一次用内置识别要下载模型（约 47 MB）：先让用户点一下再下，下载时显示已等待的时间。
 * 安卓、Windows 安装包自带模型，永远返回 null。
 */
export function useModelGate(): React.ReactNode {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(() => (recognizerChoice() !== 'offline' || modelDownloaded() ? 'done' : 'idle'));
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (state !== 'loading') return;
    const t = setInterval(() => setSec((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  if (state === 'done') return null;
  const go = () => {
    setSec(0);
    setState('loading');
    loadModel()
      .then(() => setState('done'))
      .catch((e: Error) => {
        setErr(e.message);
        setState('error');
      });
  };
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-sm">
      <p className="text-ink-2">开口练习用的是内置的离线语音识别。网页版第一次使用要下载识别模型（约 {MODEL_MB} MB，只需一次）。安卓和 Windows 安装包里已经自带，不用下载。</p>
      {state === 'loading' ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-3"><Spinner className="size-4" />正在下载并载入模型，已等待 {sec} 秒…</p>
      ) : (
        <Button className="mt-3" size="sm" icon={DownloadSimple} onClick={go}>{state === 'error' ? '重试' : '下载识别模型'}</Button>
      )}
      {state === 'error' && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}

export function Recorder({ onTake, busy, disabled }: { onTake: (t: Take) => void; busy?: boolean; disabled?: boolean }) {
  const available = useRecognitionAvailable();
  const [mode, setMode] = useState<'voice' | 'type' | 'self'>('voice');
  const [session, setSession] = useState<Listening | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [self, setSelf] = useState(70);
  const [preparing, setPreparing] = useState(false);
  const gate = useModelGate();
  const startedAt = useRef(0);

  useEffect(() => {
    if (available === false) setMode('type');
  }, [available]);
  useEffect(() => () => session?.stop(), [session]);

  function start() {
    setError(null);
    try {
      const s = speech.listen();
      startedAt.current = Date.now();
      setSession(s);
      if (s.ready) {
        setPreparing(true);
        void s.ready.then(() => {
          startedAt.current = Date.now();
          setPreparing(false);
        });
      }
      s.result
        .then((transcript) => {
          // 什么都没听到就别记一个 0 分：多半是按得太快，或者离麦克风太远
          if (!transcript.trim()) setError('没听清，再读一遍试试：点麦克风后稍等半秒再开口，读完停一下再点停止。');
          else onTake({ transcript, method: speech.method, durationMs: Date.now() - startedAt.current });
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setSession(null));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      {available !== null && (
        <Segmented
          label="作答方式"
          value={mode}
          onChange={setMode}
          className="mb-3"
          options={[
            ...(available ? [{ value: 'voice' as const, label: '开口读' }] : []),
            { value: 'type' as const, label: '打字比对' },
            { value: 'self' as const, label: '自评' },
          ]}
        />
      )}
      {available === false && mode !== 'self' && (
        <p className="mb-3 text-xs text-ink-3">当前设备不支持语音识别：可以读完后把听到的自己打出来比对，或者直接自评。</p>
      )}

      {mode === 'voice' && gate}
      {mode === 'voice' && !gate && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (session ? session.stop() : start())}
            disabled={disabled || busy}
            aria-label={session ? '说完了' : '开始录音'}
            className={cx(
              'grid size-16 place-items-center rounded-full transition duration-200 active:scale-95 disabled:opacity-40',
              session ? 'bg-danger text-white [animation:pulse-ring_1.2s_ease-out_infinite]' : 'bg-go text-go-ink',
            )}
          >
            {session ? <Stop weight="fill" className="size-7" /> : <Microphone weight="fill" className="size-7" />}
          </button>
          <div className="text-sm text-ink-2">{session ? (preparing ? '正在准备识别…' : '正在听……读完点一下停止') : busy ? '正在评分…' : '点麦克风开始读'}</div>
        </div>
      )}

      {mode === 'type' && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onTake({ transcript: typed.trim(), method: 'textCompare', durationMs: 0 });
          }}
        >
          <Input lang="ja" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="把你读的内容打出来（假名或汉字都行）" maxLength={1000} aria-label="作答" />
          <Button type="submit" icon={Keyboard} loading={busy} disabled={disabled || !typed.trim()} className="shrink-0">比对</Button>
        </form>
      )}

      {mode === 'self' && (
        <div className="flex flex-wrap items-center gap-3">
          <input type="range" min={0} max={100} step={5} value={self} onChange={(e) => setSelf(Number(e.target.value))} className="w-48 accent-[var(--go)]" aria-label="自评分" />
          <span className="font-sign w-10 text-xl font-bold tabular">{self}</span>
          <Button onClick={() => onTake({ transcript: '', method: 'selfAssessed', durationMs: 0, selfScore: self })} loading={busy} disabled={disabled}>记下</Button>
        </div>
      )}

      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
    </div>
  );
}

export function DiffView({ diff }: { diff: DiffSegment[] }) {
  if (!diff.length) return null;
  return (
    <p lang="ja" className="text-lg leading-loose">
      {diff.map((d, i) =>
        d.op === 'equal' ? (
          <span key={i}>{d.expected}</span>
        ) : d.op === 'delete' ? (
          <span key={i} className="rounded bg-danger-soft px-0.5 text-danger underline decoration-wavy underline-offset-4" title="漏读">{d.expected}</span>
        ) : d.op === 'insert' ? (
          <span key={i} className="rounded bg-surface-2 px-0.5 text-ink-3 line-through" title="多读">{d.actual}</span>
        ) : (
          <span key={i} className="rounded bg-[color-mix(in_oklab,var(--warn)_16%,transparent)] px-0.5 text-warn" title={`应为「${d.expected}」`}>
            {d.actual}
            <sup className="ml-0.5 text-[0.6em]">{d.expected}</sup>
          </span>
        ),
      )}
    </p>
  );
}

export function ScoreBars({ scores, color = 'var(--go)' }: { scores: SpeechScores; color?: string }) {
  const rows: Array<[string, number]> = [
    ['准确', scores.accuracy],
    ['完整', scores.completeness],
    ['流利', scores.fluency],
  ];
  return (
    <div className="flex items-center gap-5">
      <div className="text-center">
        <div className="font-sign text-5xl font-bold leading-none tabular" style={{ color }}>{scores.overall}</div>
        <div className="mt-1 text-xs font-semibold text-ink-3">综合</div>
      </div>
      <dl className="flex-1 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <dt className="w-7 font-semibold text-ink-3">{k}</dt>
            <dd className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]" style={{ width: `${v}%`, background: color }} />
            </dd>
            <span className="font-sign w-7 text-right font-semibold tabular">{v}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}
