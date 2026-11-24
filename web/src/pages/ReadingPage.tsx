/**
 * 阅读：带注音的短文。打开即计时，读完答理解题，记录字/分；生词可一键入卡。
 * 正文里只放行 <ruby>/<rt>，其余一律转义 —— 内容虽来自自家服务器，也不给 HTML 注入留口子。
 */
import { BookOpenText, BookmarkSimple, CheckCircle, Eye, EyeSlash, Timer, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ReadingAttempt, ReadingMaterial } from '@shared/types';
import { cardsApi, readingApi } from '@/api/endpoints';
import { Button, Card, Notice, PageHeader, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { useStudyTimer } from '@/lib/study';

const LINE = lineOf('reading');

/** 只保留 ruby 注音标签 */
export function rubyHtml(src: string): string {
  const escaped = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/&lt;(\/?)(ruby|rt)&gt;/g, '<$1$2>');
}

export function ReadingPage() {
  useStudyTimer('reading');
  const list = useQuery({ queryKey: ['reading'], queryFn: () => readingApi.materials() });
  const done = useQuery({ queryKey: ['reading-attempts'], queryFn: () => readingApi.attempts({ limit: 100 }) });
  const best = new Map<string, ReadingAttempt>();
  for (const a of done.data?.items ?? []) if (!best.has(a.materialId)) best.set(a.materialId, a);
  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="阅读" subtitle="带注音的短文，读完答两道理解题，记录阅读速度" />
      {list.isError ? (
        <Notice tone="error">{errorText(list.error)}</Notice>
      ) : !list.data ? (
        <Skeleton className="h-64" />
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2">
          {list.data.items.map((m) => {
            const a = best.get(m.id);
            return (
              <li key={m.id}>
                <Link to={`/reading/${m.id}`} viewTransition className="flex h-full flex-col rounded-2xl bg-surface p-4 lift transition hover:-translate-y-0.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-ink-3">
                    <span className="font-sign rounded-md bg-surface-2 px-1.5 py-0.5">{m.level}</span>
                    {m.topic} · {m.charCount} 字
                  </div>
                  <div className="mt-2 flex-1 text-lg font-bold">{m.title}</div>
                  {a && <div className="mt-2 text-xs text-ink-3">上次 {a.charsPerMinute} 字/分{a.comprehensionTotal ? ` · 理解 ${a.comprehensionCorrect}/${a.comprehensionTotal}` : ''}</div>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ReadingMaterialPage() {
  useStudyTimer('reading');
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['reading', id], queryFn: () => readingApi.material(id) });
  return (
    <div>
      <PageHeader line={LINE} back="/reading" title={q.data?.title ?? '阅读'} subtitle={q.data ? `${q.data.level} · ${q.data.topic} · ${q.data.charCount} 字` : undefined} />
      {q.isError ? <Notice tone="error">{errorText(q.error)}</Notice> : !q.data ? <Skeleton className="h-96" /> : <Reader m={q.data} />}
    </div>
  );
}

function Reader({ m }: { m: ReadingMaterial }) {
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [furigana, setFurigana] = useState(true);
  const [looked, setLooked] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const html = useMemo(() => rubyHtml(m.body), [m.body]);
  const submit = useMutation({
    mutationFn: () =>
      readingApi.record({
        materialId: m.id,
        durationMs: Math.max(1000, Date.now() - startedAt.current),
        lookedUpWords: looked,
        answers: Object.entries(answers).map(([questionId, choiceIndex]) => ({ questionId, choiceIndex })),
      }),
  });
  useEffect(() => {
    if (submit.isSuccess) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(t);
  }, [submit.isSuccess]);

  const mmss = `${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold lift"><Timer className="size-4" /><span className="font-sign tabular">{mmss}</span></span>
        <Button size="sm" variant="ghost" icon={furigana ? EyeSlash : Eye} onClick={() => setFurigana((v) => !v)}>{furigana ? '隐藏注音' : '显示注音'}</Button>
      </div>

      <article
        lang="ja"
        className={cx('rounded-2xl bg-surface px-5 py-6 text-[19px] leading-[2.3] lift sm:px-8', !furigana && '[&_rt]:invisible')}
        // eslint-disable-next-line react/no-danger -- 已转义，只放行 ruby/rt
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <Card title="生词">
        <ul className="grid gap-2 sm:grid-cols-2">
          {m.glossary.map((g) => (
            <GlossaryItem key={g.word} g={g} onLook={() => setLooked((l) => (l.includes(g.word) ? l : [...l, g.word]))} />
          ))}
        </ul>
      </Card>

      <Card title="理解题">
        <ol className="space-y-4">
          {m.questions.map((q, qi) => (
            <li key={q.id}>
              <p lang="ja" className="mb-2 font-semibold"><span className="font-sign mr-2 text-ink-3">{qi + 1}</span>{q.stem}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((o, oi) => (
                  <button
                    key={oi}
                    lang="ja"
                    disabled={submit.isSuccess}
                    onClick={() => setAnswers({ ...answers, [q.id]: oi })}
                    className={cx('min-h-11 rounded-xl px-3 text-left ring-1 ring-inset transition', answers[q.id] === oi ? 'bg-surface-2 ring-ink/50' : 'ring-line hover:ring-rail')}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>
        {submit.data ? (
          <div className="mt-5 flex flex-wrap items-center gap-6 rounded-xl bg-surface-2 p-4">
            <div><div className="font-sign text-3xl font-bold" style={{ color: LINE.color }}>{submit.data.charsPerMinute}</div><div className="text-xs font-semibold text-ink-3">字 / 分钟</div></div>
            {submit.data.comprehensionTotal !== null && (
              <div className="flex items-center gap-2 text-sm font-semibold">
                {submit.data.comprehensionCorrect === submit.data.comprehensionTotal ? <CheckCircle weight="fill" className="size-5 text-ok" /> : <XCircle weight="fill" className="size-5 text-warn" />}
                理解题 {submit.data.comprehensionCorrect}/{submit.data.comprehensionTotal}
              </div>
            )}
          </div>
        ) : (
          <Button className="mt-5" icon={BookOpenText} onClick={() => submit.mutate()} loading={submit.isPending}>读完了</Button>
        )}
        {submit.isError && <Notice tone="error" className="mt-2">{errorText(submit.error)}</Notice>}
      </Card>
    </div>
  );
}

function GlossaryItem({ g, onLook }: { g: ReadingMaterial['glossary'][number]; onLook: () => void }) {
  const save = useMutation({ mutationFn: () => cardsApi.create({ front: g.word, reading: g.reading, back: g.meaningZh, source: 'reading' }) });
  return (
    <li className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2" onMouseEnter={onLook} onFocus={onLook}>
      <div className="min-w-0 flex-1">
        <span lang="ja" className="font-bold">{g.word}</span> <span lang="ja" className="text-sm text-ink-3">{g.reading}</span>
        <div className="text-sm text-ink-2">{g.meaningZh}</div>
      </div>
      <button onClick={() => { onLook(); save.mutate(); }} disabled={save.isPending || save.isSuccess} aria-label={`把「${g.word}」加入抽认卡`} className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface hover:text-ink disabled:opacity-60">
        {save.isSuccess ? <CheckCircle weight="fill" className="size-5 text-ok" /> : <BookmarkSimple className="size-5" />}
      </button>
    </li>
  );
}
