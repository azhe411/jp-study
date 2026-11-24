/**
 * 本课练习（契约 v1.5.0）：题目全部取自这一课的生词和例句，不用 AI、打开即练。
 *   普通课：听音选意思 → 看词选读音 → 听例句选翻译 → 跟读例句
 *   假名课：听音选假名 → 看假名选读音
 * 做完把成绩记到这一课（今日路线据此把"练习"一站打勾），然后去考过关小测。
 */
import { ArrowRight, CheckCircle, Microphone, SpeakerHigh, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Lesson } from '@shared/types';
import { learnApi, speakingApi } from '@/api/endpoints';
import { useModelGate } from '@/components/practice';
import { Button, Card, Notice, PageHeader, Skeleton, cx, errorText } from '@/components/ui';
import { JaText, useSettingsData, useStudyTimer } from '@/lib/study';
import { prefetchAudio } from '@/platform/audio';
import { displayTranscript, warmRecognizer } from '@/platform/recognizer';
import { speech } from '@/platform/speech';
import { pitchCell } from '@/lib/pitch';

type Item =
  | { kind: 'choice'; prompt: string; audio: string | null; ja: string | null; options: string[]; answer: number; note: string }
  | { kind: 'speak'; ja: string; reading: string; zh: string };

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 正确项 + 从同课里挑 3 个不同的干扰项，打乱后返回选项与正确下标 */
function choices(right: string, pool: string[]): { options: string[]; answer: number } | null {
  const others = shuffle([...new Set(pool.filter((x) => x && x !== right))]).slice(0, 3);
  if (others.length < 2) return null;
  const options = shuffle([right, ...others]);
  return { options, answer: options.indexOf(right) };
}

function build(l: Lesson): Item[] {
  const items: Item[] = [];
  // 第 0 站还没学假名，不设练习（否则一上来就要听、要读整句日语）
  if (l.kind === 'guide') return items;
  // 声调课：同音不同调，要听高低，不能按假名去重
  const pitch = (l.kanaRows ?? []).map((row) => row.map((c) => pitchCell(c.kana, c.romaji))).filter((row) => row.every(Boolean)) as Array<Array<NonNullable<ReturnType<typeof pitchCell>>>>;
  if (pitch.length) {
    for (const row of shuffle(pitch)) {
      for (const c of row) {
        const options = shuffle(row.map((x) => x.word));
        items.push({ kind: 'choice', prompt: '听发音，选出听到的词', audio: c.word, ja: null, options, answer: options.indexOf(c.word), note: `${c.word}（${c.reading}）：${c.label}` });
      }
    }
    for (const c of shuffle(pitch.flat())) {
      const options = ['高低', '低高'];
      items.push({ kind: 'choice', prompt: '这个词的高低是？', audio: null, ja: c.word, options, answer: options.indexOf(c.label), note: `${c.word}（${c.reading}）：${c.label}` });
    }
    return items;
  }
  if (l.kanaRows?.length) {
    const cells = [...new Map(l.kanaRows.flat().map((c) => [c.kana.replace(/（.*?）/g, ''), c])).entries()].map(([kana, c]) => ({ kana, romaji: c.romaji }));
    for (const c of shuffle(cells).slice(0, 12)) {
      const ch = choices(c.kana, cells.map((x) => x.kana));
      if (ch) items.push({ kind: 'choice', prompt: '听发音，选出对应的假名', audio: c.kana, ja: null, ...ch, note: `${c.kana} 读作 ${c.romaji}` });
    }
    for (const c of shuffle(cells).slice(0, 8)) {
      const ch = choices(c.romaji, cells.map((x) => x.romaji));
      if (ch) items.push({ kind: 'choice', prompt: '这个假名怎么读？', audio: null, ja: c.kana, ...ch, note: `${c.kana} 读作 ${c.romaji}` });
    }
    return items;
  }
  const vocab = l.vocab;
  const examples = [...l.sections.flatMap((s) => s.examples), ...(l.sentences ?? [])];
  for (const w of shuffle(vocab).slice(0, 10)) {
    const ch = choices(w.meaningZh, vocab.map((x) => x.meaningZh));
    if (ch) items.push({ kind: 'choice', prompt: '听一听，是什么意思？', audio: w.word, ja: null, ...ch, note: `${w.word}（${w.reading}）：${w.meaningZh}` });
  }
  for (const w of shuffle(vocab.filter((x) => x.reading && x.reading !== x.word)).slice(0, 5)) {
    const ch = choices(w.reading, vocab.map((x) => x.reading));
    if (ch) items.push({ kind: 'choice', prompt: '这个词怎么读？', audio: null, ja: w.word, ...ch, note: `${w.word} 读作 ${w.reading}` });
  }
  for (const e of shuffle(examples).slice(0, 6)) {
    const ch = choices(e.zh, examples.map((x) => x.zh));
    if (ch) items.push({ kind: 'choice', prompt: '听例句，选出正确的意思', audio: e.ja, ja: null, ...ch, note: `${e.ja}　${e.zh}` });
  }
  for (const e of shuffle(examples).slice(0, 3)) items.push({ kind: 'speak', ja: e.ja, reading: e.reading, zh: e.zh });
  return items;
}

/** 识别结果与原句的相似度（最长公共子序列 / 原句长度），忽略标点和空格 */
function similarity(said: string, target: string): number {
  // 去标点空白，片假名统一成平假名：识别结果写成哪种都能对上
  const clean = (s: string) => s.replace(/[\s、。，．,.!！?？「」『』]/g, '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const a = clean(said);
  const b = clean(target);
  if (!b) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length] / b.length;
}

export function LessonPracticePage() {
  useStudyTimer('lesson');
  useEffect(warmRecognizer, []);
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['lesson', id, 'noPersist'], queryFn: () => learnApi.lesson(id), staleTime: Infinity, gcTime: 0 });
  return (
    <div>
      <PageHeader back={`/learn/${id}`} title="本课练习" subtitle={q.data ? `第 ${q.data.order} 站 · ${q.data.title}` : undefined} />
      {q.isError ? <Notice tone="error">{errorText(q.error)}</Notice> : !q.data ? <Skeleton className="h-64" /> : <Practice key={q.dataUpdatedAt} l={q.data} />}
    </div>
  );
}

function Practice({ l }: { l: Lesson }) {
  const qc = useQueryClient();
  const settings = useSettingsData();
  const [round, setRound] = useState(0);
  const items = useMemo(() => build(l), [l, round]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const finished = i >= items.length;

  useEffect(() => {
    void prefetchAudio(items.flatMap((x) => (x.kind === 'choice' ? (x.audio ? [x.audio] : []) : [x.ja])));
  }, [items]);

  const save = useMutation({
    mutationFn: () => learnApi.practice(l.id, correct, items.length),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['route-today'] });
    },
  });
  useEffect(() => {
    if (finished && items.length && save.isIdle) save.mutate();
  }, [finished, items.length, save]);

  if (!items.length) {
    return (
      <Card>
        <p className="text-[15px]">这一站是入门说明，没有单独的练习。读完讲解就可以直接去考小测。</p>
        <Link to={`/learn/${l.id}#quiz`} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-go px-4 font-bold text-go-ink">去考过关小测 <ArrowRight className="size-4" /></Link>
      </Card>
    );
  }

  if (finished) {
    const score = Math.round((correct / items.length) * 100);
    return (
      <Card>
        <div className="font-sign text-5xl font-bold tabular" style={{ color: score >= 80 ? 'var(--ok)' : 'var(--warn)' }}>{score}</div>
        <p className="mt-2 text-[15px]">{items.length} 题答对 {correct} 题。{score >= 80 ? '可以去考过关小测了。' : '没关系，错的那几个再看一眼讲解，再练一次会好很多。'}</p>
        {save.isError && <Notice tone="error" className="mt-3">成绩没存上：{errorText(save.error)}</Notice>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to={`/learn/${l.id}#quiz`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-go px-4 font-bold text-go-ink">去考过关小测 <ArrowRight className="size-4" /></Link>
          <Button variant="outline" onClick={() => { setRound(round + 1); setI(0); setCorrect(0); setPicked(null); save.reset(); }}>再练一次</Button>
        </div>
      </Card>
    );
  }

  const item = items[i];
  const next = (ok: boolean) => {
    if (ok) setCorrect((c) => c + 1);
    setPicked(null);
    setI(i + 1);
  };

  return (
    <div className="space-y-4">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={i} aria-valuemax={items.length}>
        <div className="h-full rounded-full bg-go transition-[width] duration-300" style={{ width: `${(i / items.length) * 100}%` }} />
      </div>
      {item.kind === 'choice' ? (
        <ChoiceItem key={`${round}-${i}`} item={item} rate={settings?.speechRate ?? 1} picked={picked} onPick={setPicked} onNext={() => next(picked === item.answer)} />
      ) : (
        <SpeakItem key={`${round}-${i}`} item={item} rate={settings?.speechRate ?? 1} onDone={next} />
      )}
      <p className="text-center text-sm text-ink-3">{i + 1} / {items.length}</p>
    </div>
  );
}

function PlayButton({ text, rate, auto = false }: { text: string; rate: number; auto?: boolean }) {
  const [busy, setBusy] = useState(false);
  const play = async () => {
    setBusy(true);
    try {
      await speech.speak(text, { rate });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (auto) void play();
    return () => void speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button type="button" onClick={() => void play()} aria-label="再听一遍" className={cx('grid size-20 place-items-center rounded-full transition active:scale-95', busy ? 'bg-go text-go-ink' : 'bg-surface-2 text-ink hover:bg-go-soft')}>
      <SpeakerHigh weight="fill" className="size-9" />
    </button>
  );
}

function ChoiceItem({ item, rate, picked, onPick, onNext }: { item: Extract<Item, { kind: 'choice' }>; rate: number; picked: number | null; onPick: (i: number) => void; onNext: () => void }) {
  const answered = picked !== null;
  return (
    <Card>
      <p className="mb-4 text-[15px] font-semibold text-ink-2">{item.prompt}</p>
      <div className="mb-5 flex justify-center">
        {item.audio ? <PlayButton text={item.audio} rate={rate} auto /> : <span lang="ja" className="text-5xl font-bold">{item.ja}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {item.options.map((o, k) => {
          const right = answered && k === item.answer;
          const wrong = answered && k === picked && k !== item.answer;
          return (
            <button
              key={k}
              type="button"
              lang="ja"
              disabled={answered}
              onClick={() => onPick(k)}
              className={cx('flex min-h-12 items-center gap-2 rounded-xl px-3 text-left text-[16px] ring-1 ring-inset transition', right ? 'bg-go-soft ring-ok/50' : wrong ? 'bg-danger-soft ring-danger/40' : 'ring-line hover:ring-rail')}
            >
              <span className="flex-1">{o}</span>
              {right && <CheckCircle weight="fill" className="size-5 text-ok" />}
              {wrong && <XCircle weight="fill" className="size-5 text-danger" />}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p lang="ja" className="min-w-0 flex-[1_1_12rem] rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{item.note}</p>
          <Button onClick={onNext} icon={ArrowRight}>下一题</Button>
        </div>
      )}
    </Card>
  );
}

/** 内置识别精度有限：和原句有四成对得上就算读出来了 */
const PASS = 0.4;

function SpeakItem({ item, rate, onDone }: { item: Extract<Item, { kind: 'speak' }>; rate: number; onDone: (ok: boolean) => void }) {
  const gate = useModelGate();
  const [preparing, setPreparing] = useState(false);
  const [canListen, setCanListen] = useState<boolean | null>(null);
  const [listening, setListening] = useState<{ stop: () => void } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void speech.recognitionAvailable().then(setCanListen);
  }, []);

  /**
   * 交给服务端按读音评分（内置识别常把读对的词写成汉字，服务端会查读音再比），顺便记进跟读记录。
   * 断网时退回本机按字比对。
   */
  const judge = async (heard: string) => {
    setSaid(heard);
    if (!heard.trim()) {
      setErr('没听清，再读一遍试试：点按钮后稍等半秒再开口，读完停一下再点"说完了"。');
      setSaid(null);
      return;
    }
    try {
      const a = await speakingApi.create({ mode: 'reading', sourceType: 'custom', referenceText: item.ja, referenceReading: item.reading, transcript: heard, method: speech.method, durationMs: 0 });
      setScore(a.scores.completeness / 100);
    } catch {
      setScore(Math.max(similarity(heard, item.ja), similarity(heard, item.reading)));
    }
  };

  const start = () => {
    setErr(null);
    setSaid(null);
    setScore(null);
    try {
      const l = speech.listen();
      setListening(l);
      if (l.ready) {
        setPreparing(true);
        void l.ready.then(() => setPreparing(false));
      }
      l.result.then(judge, (e: Error) => setErr(e.message)).finally(() => setListening(null));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Card>
      <p className="mb-3 text-[15px] font-semibold text-ink-2">先听，再跟着读一遍</p>
      <div className="flex items-center gap-4">
        <PlayButton text={item.ja} rate={rate} auto />
        <div className="min-w-0 flex-1">
          <JaText text={item.ja} reading={item.reading} mode="always" className="text-xl font-bold" />
          <p className="text-sm text-ink-3">{item.zh}</p>
        </div>
      </div>
      {canListen && gate ? (
        <div className="mt-5 space-y-3">
          {gate}
          <Button variant="outline" onClick={() => onDone(true)}>先跳过这题</Button>
        </div>
      ) : canListen ? (
        <div className="mt-5 space-y-3">
          <Button size="lg" icon={Microphone} variant={listening ? 'danger' : 'primary'} onClick={() => (listening ? listening.stop() : start())}>
            {listening ? (preparing ? '准备中…' : '说完了') : said === null ? '按下开始跟读' : '再读一遍'}
          </Button>
          {said !== null && score !== null && (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
              听到的是：<span lang="ja" className="font-semibold">{displayTranscript(said) || '（没听清）'}</span>
              <span className={cx('ml-2 font-bold', score! >= PASS ? 'text-ok' : 'text-warn')}>{score! >= PASS ? '读得不错' : '再试试，慢一点也没关系'}</span>
            </p>
          )}
          {err && <Notice tone="warn">{err}</Notice>}
          {said !== null && score !== null && <Button variant="outline" onClick={() => onDone(score! >= PASS)} icon={ArrowRight}>下一题</Button>}
          {said !== null && score !== null && score < PASS && <p className="text-xs text-ink-3">识别本身不太准：如果您确定读对了，直接点"下一题"也没关系。</p>}
        </div>
      ) : canListen === false ? (
        <div className="mt-5">
          <p className="mb-3 text-sm text-ink-3">这台设备不能语音识别。请对着屏幕大声读一遍，然后自己判断：</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onDone(true)}>读出来了</Button>
            <Button variant="outline" onClick={() => onDone(false)}>还读不顺</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
