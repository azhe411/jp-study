/**
 * AI 查询：词 / 语法 / 汉字。讲解 + 3 例句 + 3 道小测验（答错自动进错题本），单词可一键加入抽认卡。
 */
import { BookmarkSimple, CheckCircle, MagnifyingGlass, Sparkle, XCircle } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { LookupType } from '@shared/constants';
import type { Example, GrammarLookup, KanjiLookup, LookupResult, QuizCheckResult, WordLookup } from '@shared/types';
import { aiApi, cardsApi } from '@/api/endpoints';
import { Button, Card, EmptyState, Input, Notice, PageHeader, Segmented, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, SpeakButton, useSettingsData, useStudyTimer } from '@/lib/study';

const LINE = lineOf('lookup');
const HISTORY_KEY = 'jp.lookupHistory';

function loadHistory(): Array<{ type: LookupType; query: string }> {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function LookupPage() {
  useStudyTimer('lookup');
  const [type, setType] = useState<LookupType>('word');
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [history, setHistory] = useState(loadHistory);

  const lookup = useMutation({
    mutationFn: (v: { type: LookupType; query: string; context?: string }) => aiApi.lookup(v.type, v.query, v.context),
    onSuccess: (_r, v) => {
      const next = [{ type: v.type, query: v.query }, ...history.filter((h) => !(h.type === v.type && h.query === v.query))].slice(0, 12);
      setHistory(next);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* 存不了历史也不影响查询 */
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) lookup.mutate({ type, query: q, context: context.trim() || undefined });
  }

  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="AI 查询" subtitle="讲解、例句和小测验，答错的题自动进错题本" />

      <form onSubmit={submit} className="rounded-2xl bg-surface p-4 lift">
        <Segmented
          label="查询类型"
          value={type}
          onChange={setType}
          className="mb-3 w-full sm:w-auto"
          options={[
            { value: 'word', label: '单词' },
            { value: 'grammar', label: '语法' },
            { value: 'kanji', label: '汉字' },
          ]}
        />
        <div className="flex gap-2">
          <Input
            lang="ja"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={{ word: '食べる、勉強…', grammar: '〜てもいい、〜ながら…', kanji: '語' }[type]}
            maxLength={type === 'kanji' ? 2 : 60}
            aria-label="查询内容"
            className="text-lg"
          />
          <Button type="submit" icon={MagnifyingGlass} loading={lookup.isPending} disabled={!query.trim()} className="shrink-0">查询</Button>
        </div>
        {type !== 'kanji' && (
          <Input lang="ja" value={context} onChange={(e) => setContext(e.target.value)} placeholder="（可选）它出现在哪句话里，讲解会更贴切" maxLength={300} className="mt-2 text-sm" aria-label="语境" />
        )}
        {history.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {history.map((h) => (
              <button
                key={`${h.type}:${h.query}`}
                type="button"
                lang="ja"
                onClick={() => { setType(h.type); setQuery(h.query); lookup.mutate(h); }}
                className="min-h-8 rounded-full bg-surface-2 px-3 text-[13px] text-ink-2 hover:text-ink"
              >
                {h.query}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="mt-5">
        {lookup.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
            <p className="flex items-center justify-center gap-2 text-sm text-ink-3"><Sparkle className="size-4 animate-pulse" /> AI 老师正在写讲解，第一次查一个词要几秒</p>
          </div>
        ) : lookup.isError ? (
          <Notice tone="error">{errorText(lookup.error)}</Notice>
        ) : lookup.data ? (
          <Result key={lookup.data.quiz.quizId} r={lookup.data} />
        ) : (
          <Card><EmptyState icon={MagnifyingGlass} title="查点什么吧">同一个词第二次查会直接用缓存，几乎是秒出。</EmptyState></Card>
        )}
      </div>
    </div>
  );
}

function Result({ r }: { r: LookupResult }) {
  return (
    <div className="space-y-4">
      {r.type === 'word' && <WordHead r={r} />}
      {r.type === 'grammar' && <GrammarHead r={r} />}
      {r.type === 'kanji' && <KanjiHead r={r} />}
      <Examples examples={r.examples} />
      <Quiz r={r} />
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2">{children}</span>;
}

function WordHead({ r }: { r: WordLookup }) {
  const settings = useSettingsData();
  const save = useMutation({
    mutationFn: () =>
      cardsApi.create({
        front: r.headword,
        reading: r.reading,
        back: r.meaningsZh.join('；'),
        example: r.examples[0]?.ja ?? null,
        exampleTranslation: r.examples[0]?.zh ?? null,
        jlptLevel: r.jlptLevel,
        source: 'lookup',
        deck: settings?.defaultDeck,
      }),
  });
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <JaText text={r.headword} reading={r.reading} mode="always" className="text-3xl font-black" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tag>{r.partOfSpeech}</Tag>
            {r.jlptLevel && <Tag>{r.jlptLevel}</Tag>}
            {r.pitchAccent && <Tag>音调 {r.pitchAccent}</Tag>}
            {r.cached && <Tag>缓存</Tag>}
          </div>
        </div>
        <SpeakButton text={r.headword} />
      </div>
      <p className="mt-3 text-lg font-bold">{r.meaningsZh.join('；')}</p>
      <p className="mt-2 leading-relaxed text-ink-2">{r.explanationZh}</p>
      <Button variant="outline" size="sm" icon={save.isSuccess ? CheckCircle : BookmarkSimple} className="mt-4" loading={save.isPending} disabled={save.isSuccess} onClick={() => save.mutate()}>
        {save.isSuccess ? '已加入抽认卡' : '加入抽认卡'}
      </Button>
      {save.isError && <Notice tone="error" className="mt-2">{errorText(save.error)}</Notice>}
    </Card>
  );
}

function GrammarHead({ r }: { r: GrammarLookup }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div lang="ja" className="flex-1 text-3xl font-black">{r.pattern}</div>
        <SpeakButton text={r.pattern.replace(/[〜~]/g, '')} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {r.jlptLevel && <Tag>{r.jlptLevel}</Tag>}
        {r.register && <Tag>{{ plain: '普通体', polite: '丁宁体', keigo: '敬语' }[r.register]}</Tag>}
      </div>
      <p className="mt-3 text-lg font-bold">{r.meaningZh}</p>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="rounded-xl bg-surface-2 px-3 py-2"><dt className="text-xs font-semibold text-ink-3">接续</dt><dd lang="ja">{r.connection}</dd></div>
      </dl>
      <p className="mt-3 leading-relaxed text-ink-2">{r.nuanceZh}</p>
      {r.similarPatterns.length > 0 && <p className="mt-2 text-sm text-ink-3">相近：<span lang="ja">{r.similarPatterns.join('、')}</span></p>}
    </Card>
  );
}

function KanjiHead({ r }: { r: KanjiLookup }) {
  return (
    <Card>
      <div className="flex items-start gap-5">
        <div lang="ja" className="grid size-24 shrink-0 place-items-center rounded-2xl bg-surface-2 text-6xl font-black">{r.character}</div>
        <div className="min-w-0 flex-1 space-y-1.5 text-sm">
          <div><span className="text-ink-3">音读　</span><span lang="ja" className="font-semibold">{r.onyomi.join('、') || '—'}</span></div>
          <div><span className="text-ink-3">训读　</span><span lang="ja" className="font-semibold">{r.kunyomi.join('、') || '—'}</span></div>
          <div><span className="text-ink-3">部首　</span><span lang="ja">{r.radical}</span><span className="ml-4 text-ink-3">画数　</span><span className="font-sign font-semibold">{r.strokeCount}</span></div>
          <div className="font-bold">{r.meaningsZh.join('；')}</div>
        </div>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {r.commonWords.map((w) => (
          <li key={w.word} className="rounded-xl bg-surface-2 px-3 py-2">
            <JaText text={w.word} reading={w.reading} mode="always" className="font-bold" />
            <div className="text-sm text-ink-3">{w.meaningZh}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Examples({ examples }: { examples: Example[] }) {
  const settings = useSettingsData();
  return (
    <Card title="例句">
      <ol className="space-y-3">
        {examples.map((e, i) => (
          <li key={i} className="flex gap-3">
            <span className="font-sign mt-1 text-sm font-bold text-ink-3">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <JaText text={e.ja} reading={e.reading} mode={settings?.furiganaMode} className="text-[17px] font-semibold leading-snug" />
              <div className="text-sm text-ink-3">{e.zh}</div>
            </div>
            <SpeakButton text={e.ja} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Quiz({ r }: { r: LookupResult }) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const check = useMutation({
    mutationFn: () => aiApi.check(r.quiz.quizId, Object.entries(picked).map(([questionId, choiceIndex]) => ({ questionId, choiceIndex }))),
  });
  const result: QuizCheckResult | undefined = check.data;
  const byQ = new Map(result?.results.map((x) => [x.questionId, x]));
  const all = r.quiz.questions.every((q) => picked[q.id] !== undefined);

  return (
    <Card title="小测验" action={result && <span className="font-sign text-lg font-bold">{result.correctCount}/{result.total}</span>}>
      <ol className="space-y-5">
        {r.quiz.questions.map((q, qi) => {
          const res = byQ.get(q.id);
          return (
            <li key={q.id}>
              <p className="mb-2 font-semibold"><span className="font-sign mr-2 text-ink-3">{qi + 1}</span><span lang="ja">{q.stem}</span></p>
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((o, oi) => {
                  const chosen = picked[q.id] === oi;
                  const right = res && res.answerIndex === oi;
                  const wrong = res && chosen && !res.correct;
                  return (
                    <button
                      key={oi}
                      type="button"
                      lang="ja"
                      disabled={!!result}
                      onClick={() => setPicked({ ...picked, [q.id]: oi })}
                      className={cx(
                        'flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-[15px] ring-1 ring-inset transition',
                        right ? 'bg-go-soft ring-ok/50' : wrong ? 'bg-danger-soft ring-danger/40' : chosen ? 'bg-surface-2 ring-ink/50' : 'ring-line hover:ring-rail',
                      )}
                    >
                      <span className="font-sign w-4 text-sm font-bold text-ink-3">{'ABCD'[oi]}</span>
                      <span className="flex-1">{o}</span>
                      {right && <CheckCircle weight="fill" className="size-5 text-ok" />}
                      {wrong && <XCircle weight="fill" className="size-5 text-danger" />}
                    </button>
                  );
                })}
              </div>
              {res && <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{res.explanationZh}{res.mistakeId && <span className="ml-1 text-ink-3">（已记入错题本）</span>}</p>}
            </li>
          );
        })}
      </ol>
      {!result && (
        <Button className="mt-5" onClick={() => check.mutate()} loading={check.isPending} disabled={!all}>交卷</Button>
      )}
      {check.isError && <Notice tone="error" className="mt-3">{errorText(check.error)}</Notice>}
    </Card>
  );
}
