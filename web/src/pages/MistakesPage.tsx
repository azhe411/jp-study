/**
 * 错题本：按错误次数排序，展开看解析；"再练一次"让 AI 出变式题，答错会累加到原错题上。
 */
import { ArrowsClockwise, CheckCircle, Plus, SealCheck, Trash, WarningCircle, XCircle } from '@phosphor-icons/react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { MISTAKE_CATEGORIES, type MistakeCategory, type MistakeSort } from '@shared/constants';
import type { Mistake, QuizCheckResult, RetryMistakeResult } from '@shared/types';
import { aiApi, mistakesApi } from '@/api/endpoints';
import { Button, Card, EmptyState, Field, Input, Notice, PageHeader, Segmented, Select, Skeleton, Textarea, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { SpeakButton, useStudyTimer } from '@/lib/study';

const LINE = lineOf('mistakes');

export const CATEGORY_ZH: Record<MistakeCategory, string> = {
  vocab: '词汇', grammar: '语法', kanji: '汉字', particle: '助词', conjugation: '活用', keigo: '敬语', idiom: '惯用语',
  listening: '听力', pronunciation: '发音', writing: '写作', reading: '阅读', other: '其他',
};

export function MistakesPage() {
  useStudyTimer('mistakes');
  const [sort, setSort] = useState<MistakeSort>('errorCountDesc');
  const [category, setCategory] = useState<MistakeCategory | ''>('');
  const [mastered, setMastered] = useState<'open' | 'mastered'>('open');
  const [adding, setAdding] = useState(false);
  const filters = { sort, category: category || undefined, mastered: mastered === 'mastered' };
  const q = useInfiniteQuery({
    queryKey: ['mistakes', filters],
    queryFn: ({ pageParam }) => mistakesApi.list({ ...filters, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="错题本" subtitle="同一道题再错会累加次数，错得越多排得越前" actions={<Button size="sm" variant="outline" icon={Plus} onClick={() => setAdding((v) => !v)}>记一题</Button>} />
      {adding && <AddMistake onDone={() => setAdding(false)} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="状态" value={mastered} onChange={setMastered} options={[{ value: 'open', label: '待攻克' }, { value: 'mastered', label: '已掌握' }]} />
        <Select value={category} onChange={(e) => setCategory(e.target.value as MistakeCategory | '')} className="w-auto min-w-28" aria-label="类别">
          <option value="">全部类别</option>
          {MISTAKE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ZH[c]}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as MistakeSort)} className="w-auto min-w-32" aria-label="排序">
          <option value="errorCountDesc">错误次数最多</option>
          <option value="lastWrongDesc">最近答错</option>
          <option value="createdDesc">最早记入</option>
        </Select>
      </div>

      {q.isError ? (
        <Notice tone="error">{errorText(q.error)}</Notice>
      ) : q.isPending ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !items.length ? (
        <Card><EmptyState icon={mastered === 'open' ? SealCheck : WarningCircle} title={mastered === 'open' ? '没有待攻克的错题' : '还没有标记掌握的题'}>做 AI 查询的小测验、敬语和汉字练习时答错的题会自动出现在这里。</EmptyState></Card>
      ) : (
        <ul className="stagger space-y-2">
          {items.map((m) => <MistakeRow key={m.id} m={m} />)}
        </ul>
      )}
      {q.hasNextPage && <div className="mt-4 text-center"><Button variant="ghost" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>加载更多</Button></div>}
    </div>
  );
}

function MistakeRow({ m }: { m: Mistake }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState<RetryMistakeResult | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['mistakes'] });
  const toggle = useMutation({ mutationFn: () => mistakesApi.update(m.id, m.version, { mastered: !m.mastered }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => mistakesApi.remove(m.id, m.version), onSuccess: refresh });
  const gen = useMutation({ mutationFn: () => mistakesApi.retry(m.id), onSuccess: setRetry });

  return (
    <li className="rounded-2xl bg-surface lift">
      <button className="flex w-full items-start gap-3 px-4 py-3.5 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="font-sign mt-0.5 grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-base font-bold tabular" style={{ background: `${LINE.color}1f`, color: 'var(--ink)' }} title="错误次数">
          ×{m.errorCount}
        </span>
        <div className="min-w-0 flex-1">
          <p lang="ja" className={cx('font-semibold', !open && 'line-clamp-2')}>{m.question}</p>
          <p className="mt-0.5 text-xs text-ink-3">{CATEGORY_ZH[m.category]} · {new Date(m.lastWrongAt).toLocaleDateString('zh-CN')}</p>
        </div>
      </button>
      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-danger-soft px-3 py-2"><dt className="text-xs font-semibold text-danger">我的答案</dt><dd lang="ja">{m.wrongAnswer || '（未作答）'}</dd></div>
            <div className="rounded-xl bg-go-soft px-3 py-2"><dt className="text-xs font-semibold text-ok">正确答案</dt><dd lang="ja">{m.correctAnswer}</dd></div>
          </dl>
          {m.explanationZh && <p className="mt-3 text-sm leading-relaxed text-ink-2">{m.explanationZh}</p>}
          {isListenPair(m) ? (
            <ListenDrill a={m.correctAnswer} b={m.wrongAnswer} onMaster={m.mastered ? undefined : () => toggle.mutate()} />
          ) : (
            NEEDS_SOUND.has(m.category) && hasKana(m.correctAnswer) && (
              <div className="mt-3 flex items-center gap-2 text-sm text-ink-2"><SpeakButton text={m.correctAnswer} label="听正确答案" />听一听正确答案</div>
            )
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" icon={ArrowsClockwise} onClick={() => gen.mutate()} loading={gen.isPending}>{isListenPair(m) ? 'AI 出几道相近的' : '再练一次'}</Button>
            <Button size="sm" variant="outline" icon={SealCheck} onClick={() => toggle.mutate()} loading={toggle.isPending}>{m.mastered ? '取消掌握' : '标记掌握'}</Button>
            <Button size="sm" variant="ghost" icon={Trash} onClick={() => confirm('删除这道错题？') && remove.mutate()} className="text-danger">删除</Button>
          </div>
          {(gen.isError || toggle.isError) && <Notice tone="error" className="mt-2">{errorText(gen.error ?? toggle.error)}</Notice>}
          {retry && <RetryQuiz r={retry} onDone={refresh} />}
        </div>
      )}
    </li>
  );
}

/** 听力、发音类的错题：光看文字没有意义，要能出声 */
const NEEDS_SOUND = new Set<MistakeCategory>(['pronunciation', 'listening']);
// 只认假名：课程小测里的发音题可能是中文概念题，答案不该拿去朗读
const hasKana = (s: string) => /[぀-ヿ]/.test(s);
const isListenPair = (m: Mistake) => m.source === 'pronunciation' && !!m.wrongAnswer && m.wrongAnswer !== m.correctAnswer;

/**
 * 听音辨词：这两个词曾经听混。每次随机读其中一个，选听到的是哪个。
 * 答案每轮都可能变，所以上面写着"正确答案"也不影响练习；不需要 AI，也不改错题记录。
 */
function ListenDrill({ a, b, onMaster }: { a: string; b: string; onMaster?: () => void }) {
  const words = useMemo(() => (Math.random() < 0.5 ? [a, b] : [b, a]), [a, b]);
  const pick = () => words[Math.floor(Math.random() * 2)];
  const [target, setTarget] = useState(pick);
  const [chosen, setChosen] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const choose = (w: string) => {
    setChosen(w);
    setScore({ right: score.right + (w === target ? 1 : 0), total: score.total + 1 });
    setStreak(w === target ? streak + 1 : 0);
  };
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <SpeakButton text={target} label="播放" />
        <span className="min-w-0 flex-1">点喇叭听，选出听到的词</span>
        {score.total > 0 && <span className="font-sign shrink-0 tabular text-ink-3">{score.right}/{score.total}</span>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {words.map((w) => (
          <button
            key={w}
            type="button"
            lang="ja"
            disabled={chosen !== null}
            onClick={() => choose(w)}
            className={cx(
              'flex min-h-11 items-center justify-center gap-2 rounded-lg bg-surface px-3 font-semibold ring-1 ring-inset',
              chosen !== null && w === target ? 'ring-ok' : chosen === w ? 'ring-danger' : 'ring-line',
            )}
          >
            {w}
            {chosen !== null && w === target && <CheckCircle weight="fill" className="size-4 text-ok" />}
            {chosen === w && w !== target && <XCircle weight="fill" className="size-4 text-danger" />}
          </button>
        ))}
      </div>
      {streak >= 3 && onMaster && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-go-soft px-3 py-2 text-sm font-semibold">
          连续听对 {streak} 次，可以算掌握了
          <Button size="sm" icon={SealCheck} onClick={onMaster}>标记掌握</Button>
        </div>
      )}
      {chosen !== null && (
        <div className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 text-ink-2">{chosen === target ? '听对了。' : `读的是「${target}」。`}</span>
          <div className="flex shrink-0 gap-1">
            {words.map((w) => <SpeakButton key={w} text={w} label={`听「${w}」`} />)}
            <Button size="sm" variant="outline" onClick={() => { setTarget(pick()); setChosen(null); }}>下一个</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RetryQuiz({ r, onDone }: { r: RetryMistakeResult; onDone: () => void }) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const check = useMutation({
    mutationFn: () => aiApi.check(r.quiz.quizId, Object.entries(picked).map(([questionId, choiceIndex]) => ({ questionId, choiceIndex }))),
    onSuccess: onDone,
  });
  const res: QuizCheckResult | undefined = check.data;
  const byQ = new Map(res?.results.map((x) => [x.questionId, x]));
  return (
    <div className="mt-4 space-y-4 rounded-xl bg-surface-2 p-3">
      {r.quiz.questions.map((q) => {
        const rr = byQ.get(q.id);
        return (
          <div key={q.id}>
            <p lang="ja" className="mb-2 text-sm font-semibold">{q.stem}</p>
            {q.audio && (
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-2">
                <SpeakButton text={q.audio} label="听发音" />
                点喇叭听发音，可以多听几遍
              </div>
            )}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {q.options.map((o, oi) => (
                <button
                  key={oi}
                  lang="ja"
                  disabled={!!res}
                  onClick={() => setPicked({ ...picked, [q.id]: oi })}
                  className={cx(
                    'flex min-h-10 items-center gap-2 rounded-lg bg-surface px-3 text-left text-sm ring-1 ring-inset',
                    rr?.answerIndex === oi ? 'ring-ok' : rr && picked[q.id] === oi ? 'ring-danger' : picked[q.id] === oi ? 'ring-ink/60' : 'ring-line',
                  )}
                >
                  {o}
                  {rr?.answerIndex === oi && <CheckCircle weight="fill" className="ml-auto size-4 text-ok" />}
                  {rr && !rr.correct && picked[q.id] === oi && <XCircle weight="fill" className="ml-auto size-4 text-danger" />}
                </button>
              ))}
            </div>
            {rr && <p className="mt-1.5 text-xs text-ink-2">{rr.explanationZh}</p>}
          </div>
        );
      })}
      {!res ? (
        <Button size="sm" onClick={() => check.mutate()} loading={check.isPending} disabled={r.quiz.questions.some((q) => picked[q.id] === undefined)}>交卷</Button>
      ) : (
        <p className="text-sm font-semibold">{res.correctCount === res.total ? '全对。可以把这题标记为掌握了。' : `答对 ${res.correctCount}/${res.total}，错的已经累加到这道错题上。`}</p>
      )}
    </div>
  );
}

function AddMistake({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ category: 'grammar' as MistakeCategory, question: '', wrongAnswer: '', correctAnswer: '', explanationZh: '' });
  const add = useMutation({
    mutationFn: () => mistakesApi.create({ ...f, source: 'manual', explanationZh: f.explanationZh || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mistakes'] });
      onDone();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (f.question.trim() && f.correctAnswer.trim()) add.mutate();
  }
  return (
    <Card className="mb-5" title="手动记一道错题">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="类别">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as MistakeCategory })}>
            {MISTAKE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ZH[c]}</option>)}
          </Select>
        </Field>
        <div className="hidden sm:block" />
        <Field label="题目" className="sm:col-span-2"><Textarea lang="ja" rows={2} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} maxLength={1000} /></Field>
        <Field label="我的答案"><Input lang="ja" value={f.wrongAnswer} onChange={(e) => setF({ ...f, wrongAnswer: e.target.value })} maxLength={1000} /></Field>
        <Field label="正确答案"><Input lang="ja" value={f.correctAnswer} onChange={(e) => setF({ ...f, correctAnswer: e.target.value })} maxLength={1000} /></Field>
        <Field label="解析（可选）" className="sm:col-span-2"><Textarea rows={2} value={f.explanationZh} onChange={(e) => setF({ ...f, explanationZh: e.target.value })} maxLength={2000} /></Field>
        <div className="sm:col-span-2"><Button type="submit" loading={add.isPending} disabled={!f.question.trim() || !f.correctAnswer.trim()}>保存</Button></div>
        {add.isError && <Notice tone="error" className="sm:col-span-2">{errorText(add.error)}</Notice>}
      </form>
    </Card>
  );
}
