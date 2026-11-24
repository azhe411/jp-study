/**
 * 一课（一站）：① 看视频 ② 读讲解（例句都能听）③ 假名表 / 生词 ④ 常见错误 ⑤ 本课练习 ⑥ 过关小测。
 * 得分 ≥ 80 才算到站：下一站解锁；没过可以"重新做"：换一份题、选项全部清空。
 * 交卷后克劳迪娅会写一份本站小结（哪里没掌握、接下来怎么补）。
 */
import { ArrowClockwise, ArrowRight, BookOpenText, ChatsCircle, CheckCircle, Lightning, PencilSimpleLine, Sparkle, Warning, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { LESSON_PASS_RATE } from '@shared/constants';
import type { CompleteLessonResult, Lesson, QuizCheckResult } from '@shared/types';
import { ApiError } from '@/api/client';
import { aiApi, coachApi, learnApi, videoApi } from '@/api/endpoints';
import { CoachCard } from '@/components/coach';
import { BiliPlayer } from '@/components/video';
import { Button, Card, EmptyState, Notice, PageHeader, Skeleton, cx, errorText } from '@/components/ui';
import { pitchCell } from '@/lib/pitch';
import { JaText, SpeakButton, useSettingsData, useStudyTimer } from '@/lib/study';
import { prefetchAudio } from '@/platform/audio';
import { speech } from '@/platform/speech';
import { PART_LABEL } from './LearnPage';

const BVID = 'BV1Bp4y1D747';

export function LessonPage() {
  useStudyTimer('lesson');
  const { id = '' } = useParams();
  // noPersist：课程里带着小测 id，小测会过期，不能存进本机缓存
  const q = useQuery({ queryKey: ['lesson', id, 'noPersist'], queryFn: () => learnApi.lesson(id), staleTime: Infinity, gcTime: 0 });
  const locked = q.error instanceof ApiError && q.error.code === 'FORBIDDEN';

  return (
    <div>
      <PageHeader back="/learn" title={q.data?.title ?? '课程'} subtitle={q.data ? `${PART_LABEL[q.data.part]} · 第 ${q.data.order} 站 · 约 ${q.data.minutes} 分钟` : undefined} />
      {locked ? (
        <Card><EmptyState icon={BookOpenText} title="这一站还没解锁" action={<Link to="/learn" className="font-semibold underline">回到课程线路</Link>}>先通过前面的课程。</EmptyState></Card>
      ) : q.isError ? (
        <Notice tone="error">{errorText(q.error)}</Notice>
      ) : !q.data ? (
        <div className="space-y-3">
          <Skeleton className="aspect-video" />
          <Skeleton className="h-40" />
          <p className="flex items-center justify-center gap-2 text-sm text-ink-3"><Sparkle className="size-4 animate-pulse" />第一次打开这一课时，讲义要现场生成，可能需要半分钟</p>
        </div>
      ) : (
        <LessonBody l={q.data} />
      )}
    </div>
  );
}

function LessonBody({ l }: { l: Lesson }) {
  const settings = useSettingsData();
  const [video, setVideo] = useState(0);
  const [allVocab, setAllVocab] = useState(false);
  const [allSentences, setAllSentences] = useState(false);
  const { hash } = useLocation();
  // 从今日路线点进来（#video / #quiz）：直接滚到那一步
  useEffect(() => {
    if (!hash) return;
    // 等视频卡片等异步内容撑开高度再滚，免得停在半路
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    return () => clearTimeout(t);
  }, [hash]);
  // 本课要听的句子和词先在后台取好，点朗读时不用等
  useEffect(() => {
    void prefetchAudio([...l.sections.flatMap((s) => s.examples.map((e) => e.ja)), ...l.vocab.slice(0, 20).map((w) => w.word)]);
  }, [l]);
  const talkable = l.kind !== 'guide' && !l.kanaRows;
  const v = l.videos[video];
  const course = useQuery({ queryKey: ['video-course', v?.courseId], queryFn: () => videoApi.course(v!.courseId), enabled: !!v });
  const prog = course.data?.episodes.find((e) => e.page === v?.page)?.progress;
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-[15px] leading-relaxed">{l.intro}</p>
        <p className="mt-2 text-sm font-semibold text-ok">学完你能：{l.goal}</p>
      </Card>

      {v && (
        <section aria-label="视频" id="video" className="scroll-mt-4">
          <h2 className="mb-2 px-1 text-[15px] font-extrabold">① 先看视频</h2>
          {l.videos.length > 1 && (
            <div className="mb-2 flex gap-2 overflow-x-auto">
              {l.videos.map((x, i) => (
                <button key={x.page} onClick={() => setVideo(i)} className={cx('min-h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold', i === video ? 'bg-ink text-ground' : 'bg-surface ring-1 ring-line')}>
                  {x.title.replace(/^.*?（/, '').replace(/）$/, '') || `第 ${i + 1} 集`}
                </button>
              ))}
            </div>
          )}
          {course.isPending ? (
            <Skeleton className="aspect-video" />
          ) : (
            <BiliPlayer key={v.page} courseId={v.courseId} bvid={BVID} page={v.page} title={v.title} durationSec={v.durationSec} savedSec={prog?.positionSec ?? 0} completed={prog?.completed ?? false} />
          )}
          <p className="mt-1 px-1 text-xs text-ink-3">视频来自 B 站"教日语的阿飞老师"的公开课程。完整合集在 <Link to="/videos/bili-afei-xinbiaori" className="underline">视频课程</Link>，会记住你看到哪一集。</p>
        </section>
      )}

      <section aria-label="讲解" className="space-y-3">
        <h2 className="px-1 text-[15px] font-extrabold">{v ? '② ' : '① '}读讲解{l.generated && <span className="ml-2 text-xs font-normal text-ink-3">（由 AI 依本课要点编写）</span>}</h2>
        {l.sections.map((s, i) => (
          <Card key={i} title={s.title}>
            <div className="space-y-3 text-[15px] leading-[1.85] text-ink">
              {s.body.split(/\n{2,}/).map((para, k) => <p key={k} className="whitespace-pre-line">{para}</p>)}
            </div>
            {s.examples.length > 0 && (
              <ul className="mt-4 space-y-2">
                {s.examples.map((e, k) => (
                  <li key={k} className="flex items-start gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <JaText text={e.ja} reading={e.reading} mode={settings?.furiganaMode === 'never' ? 'never' : 'always'} className="text-[17px] font-semibold" />
                      <div className="text-sm text-ink-3">{e.zh}</div>
                    </div>
                    <SpeakButton text={e.ja} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </section>

      {l.kanaRows && (
        <Card title={l.kanaRows.flat().some((c) => pitchCell(c.kana, c.romaji)) ? '词表：点一下听高低' : '字表：点一下听发音'}>
          <div className="space-y-1.5">
            {l.kanaRows.map((row, i) => (
              <div key={i} className={cx('grid gap-1.5', row.some((c) => pitchCell(c.kana, c.romaji)) ? 'grid-cols-2' : 'grid-cols-5')}>
                {row.map((c) => {
                  const p = pitchCell(c.kana, c.romaji);
                  return p ? (
                    <button
                      key={c.kana}
                      // 必须读汉字：同样的假名，引擎靠汉字才知道该读哪个声调
                      onClick={() => void speech.speak(p.word, { rate: 0.8 })}
                      className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 py-3 transition hover:bg-go-soft active:scale-95"
                    >
                      <span lang="ja" className="text-2xl font-bold leading-none">{p.word}</span>
                      <span lang="ja" className="flex h-7 items-center gap-0.5 text-[15px] font-semibold" aria-hidden="true">
                        {[...p.reading].map((ch, k) => (
                          <span key={k} className={(k === 0) === (p.pattern === 'HL') ? '-translate-y-1.5 text-go' : 'translate-y-1.5 text-ink-3'}>{ch}</span>
                        ))}
                      </span>
                      <span className="text-xs font-semibold text-ink-3">{p.reading} · {p.label}</span>
                    </button>
                  ) : (
                    <button
                      key={c.kana}
                      onClick={() => void speech.speak(c.kana.replace(/（.*?）/, ''), { rate: 0.8 })}
                      className="flex aspect-[4/3] flex-col items-center justify-center rounded-xl bg-surface-2 transition hover:bg-go-soft active:scale-95"
                    >
                      <span lang="ja" className="text-2xl font-bold leading-none">{c.kana}</span>
                      <span className="font-sign mt-1 text-xs text-ink-3">{c.romaji}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {l.kanaRows.flat().some((c) => pitchCell(c.kana, c.romaji)) && (
            <p className="mt-3 text-xs leading-relaxed text-ink-3">同一组读音相同，只是高低不同。声音是合成的，能听出大致走向；每个词的准确声调以词典标记为准。</p>
          )}
        </Card>
      )}

      {l.vocab.length > 0 && (
        <Card title={`本课生词 ${l.vocab.length} 个（已放进抽认卡「课程」牌组）`}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(allVocab ? l.vocab : l.vocab.slice(0, 12)).map((w) => (
              <li key={w.word} className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <JaText text={w.word} reading={w.reading} mode="always" className="font-bold" />
                  <div className="text-sm text-ink-3">{w.meaningZh}</div>
                  {w.example && <div className="mt-1 text-[13px] text-ink-2"><span lang="ja">{w.example.ja}</span><span className="block text-ink-3">{w.example.zh}</span></div>}
                </div>
                <SpeakButton text={w.word} className="size-9" />
              </li>
            ))}
          </ul>
          {l.vocab.length > 12 && !allVocab && <Button variant="ghost" className="mt-2" onClick={() => setAllVocab(true)}>展开全部 {l.vocab.length} 个</Button>}
        </Card>
      )}

      {(l.sentences?.length ?? 0) > 0 && (
        <Card title={`更多句子 ${l.sentences.length} 句（前 10 句已放进「课程句子」牌组）`}>
          <ul className="space-y-2">
            {(allSentences ? l.sentences : l.sentences.slice(0, 6)).map((e) => (
              <li key={e.ja} className="flex items-start gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <JaText text={e.ja} reading={e.reading} mode={settings?.furiganaMode === 'never' ? 'never' : 'always'} className="text-[16px] font-semibold" />
                  <div className="text-sm text-ink-3">{e.zh}</div>
                </div>
                <SpeakButton text={e.ja} className="size-9" />
              </li>
            ))}
          </ul>
          {l.sentences.length > 6 && !allSentences && <Button variant="ghost" className="mt-2" onClick={() => setAllSentences(true)}>展开全部 {l.sentences.length} 句</Button>}
        </Card>
      )}

      {l.commonMistakes.length > 0 && (
        <Card title="容易出错的地方">
          <ul className="space-y-2">
            {l.commonMistakes.map((m, i) => (
              <li key={i} className="flex gap-2 text-[15px]"><Warning weight="fill" className="mt-1 size-4 shrink-0 text-warn" />{m}</li>
            ))}
          </ul>
        </Card>
      )}

      {l.kind !== 'guide' && (
      <section aria-label="本课练习">
        <h2 className="mb-2 px-1 text-[15px] font-extrabold">考试前：先练一练</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link to={`/learn/${l.id}/practice`} className="flex min-h-16 items-center gap-3 rounded-2xl bg-surface p-4 lift transition active:scale-[0.99]">
            <PencilSimpleLine weight="duotone" className="size-7 shrink-0 text-go" />
            <span className="min-w-0 flex-1"><span className="block font-bold">本课练习</span><span className="block text-sm text-ink-3">听音选词、例句听辨、跟读，全是这一课的内容</span></span>
            <ArrowRight className="size-4 text-ink-3" />
          </Link>
          {talkable && (
            <Link to={`/talk?scenario=lesson:${l.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl bg-surface p-4 lift transition active:scale-[0.99]">
              <ChatsCircle weight="duotone" className="size-7 shrink-0 text-go" />
              <span className="min-w-0 flex-1"><span className="block font-bold">用本课句型和 AI 聊几句</span><span className="block text-sm text-ink-3">AI 只用学过的语法，引导您用上这一课</span></span>
              <ArrowRight className="size-4 text-ink-3" />
            </Link>
          )}
        </div>
      </section>
      )}

      <Quiz key={l.quiz.quizId} l={l} />
    </div>
  );
}

/** 考试前过一遍：小测里的单词题就从这张表出。默认收起，不挡着题目 */
function WordTable({ words }: { words: NonNullable<Lesson['wordList']> }) {
  if (!words.length) return null;
  return (
    <details className="mb-3 rounded-2xl bg-surface lift">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 py-2 font-bold">
        <BookOpenText weight="duotone" className="size-5 shrink-0 text-go" />
        本课单词表 {words.length} 个
        <span className="text-sm font-normal text-ink-3">小测的单词题从这里出</span>
      </summary>
      <ul className="border-t border-line px-2 pb-2">
        {words.map((w) => (
          <li key={w.word} className="flex items-center gap-3 border-b border-line px-2 py-1.5 last:border-b-0">
            <span className="min-w-0 flex-1">
              <span lang="ja" className="block font-bold">{w.word}</span>
              {w.reading !== w.word && <span lang="ja" className="block text-xs text-ink-3">{w.reading}</span>}
            </span>
            <span className="min-w-0 flex-1 text-sm text-ink-2">{w.meaningZh}</span>
            <SpeakButton text={w.word} className="size-9 shrink-0" />
          </li>
        ))}
      </ul>
    </details>
  );
}

function Quiz({ l }: { l: Lesson }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<QuizCheckResult | null>(null);
  const finish = useMutation({
    mutationFn: async () => {
      const r = await aiApi.check(l.quiz.quizId, Object.entries(picked).map(([questionId, choiceIndex]) => ({ questionId, choiceIndex })));
      setChecked(r);
      return learnApi.complete(l.id, l.quiz.quizId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['curriculum'] });
      void qc.invalidateQueries({ queryKey: ['plan-today'] });
      void qc.invalidateQueries({ queryKey: ['due'] });
      void qc.invalidateQueries({ queryKey: ['route-today'] });
      void qc.invalidateQueries({ queryKey: ['stage'] });
    },
  });
  const res: CompleteLessonResult | undefined = finish.data;
  // 重新做：拿一份新题（顺序、选项都会换），本组件随新 quizId 重新挂载，作答全部清空
  const retry = useMutation({
    mutationFn: () => qc.refetchQueries({ queryKey: ['lesson', l.id, 'noPersist'], exact: true }),
    onSuccess: () => document.getElementById('quiz')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  });
  const byQ = new Map(checked?.results.map((x) => [x.questionId, x]));
  const all = l.quiz.questions.every((q) => picked[q.id] !== undefined);

  return (
    <section aria-label="过关小测" id="quiz" className="scroll-mt-4">
      <h2 className="mb-2 px-1 text-[15px] font-extrabold">最后：过关小测（{Math.round(LESSON_PASS_RATE * 100)} 分过关）</h2>
      <WordTable words={l.wordList ?? l.vocab} />
      <Card>
        <ol className="space-y-5">
          {l.quiz.questions.map((q, qi) => {
            const r = byQ.get(q.id);
            return (
              <li key={q.id}>
                <p className="mb-2 font-semibold"><span className="font-sign mr-2 text-ink-3">{qi + 1}</span><span lang="ja">{q.stem}</span></p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {q.options.map((o, oi) => {
                    const right = r && r.answerIndex === oi;
                    const wrong = r && picked[q.id] === oi && !r.correct;
                    return (
                      <button
                        key={oi}
                        lang="ja"
                        disabled={!!checked}
                        onClick={() => setPicked({ ...picked, [q.id]: oi })}
                        className={cx(
                          'flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-[15px] ring-1 ring-inset transition',
                          right ? 'bg-go-soft ring-ok/50' : wrong ? 'bg-danger-soft ring-danger/40' : picked[q.id] === oi ? 'bg-surface-2 ring-ink/50' : 'ring-line hover:ring-rail',
                        )}
                      >
                        <span className="flex-1">{o}</span>
                        {right && <CheckCircle weight="fill" className="size-5 text-ok" />}
                        {wrong && <XCircle weight="fill" className="size-5 text-danger" />}
                      </button>
                    );
                  })}
                </div>
                {r && <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{r.explanationZh}</p>}
              </li>
            );
          })}
        </ol>

        {!res ? (
          <Button className="mt-5" size="lg" icon={Lightning} onClick={() => finish.mutate()} loading={finish.isPending} disabled={!all}>交卷</Button>
        ) : (
          <div className={cx('mt-6 rounded-2xl p-5', res.passed ? 'bg-go-soft' : 'bg-surface-2')}>
            <div className="flex flex-wrap items-center gap-4">
              <div className={cx('font-sign text-5xl font-bold tabular', res.passed && 'animate-[stamp_420ms_var(--ease-out-expo)]')} style={{ color: res.passed ? 'var(--ok)' : 'var(--warn)' }}>{res.score}</div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-black">{res.passed ? '到站了。' : '还差一点，没关系。'}</div>
                <p className="text-sm text-ink-2">
                  {res.passed
                    ? `${res.nextLesson ? '下一站已经解锁。' : '整条线路都走完了。'}${res.cardsAdded ? `下一站的 ${res.cardsAdded} 张词卡已放进复习。` : ''}`
                    : '对照上面的解析看看错在哪，再点"重新做"：会换一份题，选项全部清空。做错的题已记进错题本。'}
                </p>
              </div>
              {res.passed && res.nextLesson && (
                <Link to={`/learn/${res.nextLesson.id}`} className="flex min-h-12 items-center gap-2 rounded-2xl bg-go px-4 font-bold text-go-ink">
                  下一站 <ArrowRight weight="bold" className="size-4" />
                </Link>
              )}
              {!res.passed && (
                <Button variant="outline" icon={ArrowClockwise} loading={retry.isPending} onClick={() => retry.mutate()}>重新做</Button>
              )}
            </div>
          </div>
        )}
        {res && <CoachCard className="mt-4" queryKey={['coach', 'lesson', l.id, l.quiz.quizId]} load={() => coachApi.lesson(l.id)} />}
        {finish.isError && <Notice tone="error" className="mt-3">{errorText(finish.error)}</Notice>}
      </Card>
    </section>
  );
}
