/**
 * 今日：
 *   ① 克劳迪娅的实时点评（周一另有本周回顾）：她看得到全部学习记录，学了什么回来就评什么，不用提问
 *   ② 主线：按学习计划排出的今日路线 —— 复习 → 每课（看视频 → 本课练习 → 过关小测），
 *      每一步是否完成由学习记录自动判断，点一下直接去做
 *   ③ 加练（自选）：任务模板铺出的和手动加的任务，三种列车（各停 / 快速 / 特急）决定铺哪些
 * 完成一站，列车沿线前进到下一站；全部完成即"终点到着"。
 */
import { ArrowRight, BookOpenText, CaretLeft, CaretRight, Cards, Check, CheckCircle, DotsThreeVertical, FlagCheckered, PencilSimpleLine, Plus, SkipForward, Television, TrainSimple, Trash, Trophy } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlanBanner, usePlanToday } from './LearnPage';
import { ONBOARDED_KEY } from './OnboardingPage';
import { DAY_MODES, STUDY_MODULES, type DayMode, type StudyModule } from '@shared/constants';
import type { DailyRoute, RouteStep, Task, TodayResponse } from '@shared/types';
import { ApiError } from '@/api/client';
import { coachApi, learnApi, tasksApi } from '@/api/endpoints';
import { CoachCard, LiveCoach } from '@/components/coach';
import { Button, Card, EmptyState, IconButton, Input, LineBadge, Notice, Segmented, Select, Skeleton, cx, errorText } from '@/components/ui';
import { DAY_MODE_TRAIN, lineOf } from '@/lib/lines';
import { addDays, jaDate, todayIn, useSettingsData, useStage, weekdayOf, WEEKDAY_ZH } from '@/lib/study';

export function TodayPage() {
  const settings = useSettingsData();
  const today = todayIn(settings?.timezone);
  const [date, setDate] = useState<string | null>(null);
  const day = date ?? today;
  const isToday = day === today;

  const qc = useQueryClient();
  const key = ['today', day];
  const q = useQuery({ queryKey: key, queryFn: () => tasksApi.today(day), enabled: !!settings });

  const setStatus = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: Task['status'] }) => tasksApi.update(task.id, task.version, { status }),
    onMutate: async ({ task, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TodayResponse>(key);
      if (prev) {
        const tasks = prev.tasks.map((t) => (t.id === task.id ? { ...t, status } : t));
        qc.setQueryData<TodayResponse>(key, { ...prev, tasks, summary: { ...prev.summary, done: tasks.filter((t) => t.status === 'done').length } });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (task: Task) => tasksApi.remove(task.id, task.version),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const switchMode = useMutation({
    mutationFn: (mode: DayMode) => tasksApi.generate(day, mode, true),
    onSuccess: (r) => qc.setQueryData(key, r),
  });

  // 新账号第一次进来：还没有计划、一课都没学，先去制定计划（只自动跳一次）
  const plan = usePlanToday();
  const nav = useNavigate();
  useEffect(() => {
    const t = plan.data;
    if (!t || t.plan || t.passedCount > 0) return;
    try {
      if (localStorage.getItem(ONBOARDED_KEY)) return;
      localStorage.setItem(ONBOARDED_KEY, 'shown');
    } catch {
      return;
    }
    nav('/onboarding', { replace: true });
  }, [plan.data, nav]);

  const stage = useStage()?.stage;
  const data = q.data;
  const train = DAY_MODE_TRAIN[data?.dayMode ?? 'standard'];

  return (
    <div>
      <StationSign
        date={day}
        isToday={isToday}
        color={train.color}
        onColor={train.onColor}
        onPrev={() => setDate(addDays(day, -1))}
        onNext={() => setDate(addDays(day, 1))}
        onToday={() => setDate(null)}
      />

      {plan.data && <div className="mt-4"><PlanBanner t={plan.data} compact /></div>}

      {isToday && (
        <>
          <LiveCoach className="mt-4" />
          {weekdayOf(day) === 'mon' && <CoachCard className="mt-3" queryKey={['coach', 'weekly', day]} load={coachApi.weekly} />}
          <MainRoute />
          <h2 className="mt-8 px-1 text-[15px] font-extrabold">加练（自选）</h2>
          <p className="px-1 text-sm text-ink-3">
            {stage === 'kana' ? '五十音还没学完，加练先不急：下面这些大多要用到汉字，学到 N5 第 1 课再做也不迟。' : '主线之外想多练的放在这里。换列车档位会按设置里的模板重排。'}
          </p>
        </>
      )}

      {q.isError ? (
        <Notice tone="error" className="mt-5">{errorText(q.error)}</Notice>
      ) : !data ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-12" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="今天坐哪种车"
              value={data.dayMode}
              onChange={(m) => {
                if (m === data.dayMode) return;
                if (data.tasks.some((t) => t.templateId && t.status === 'todo') && !confirm(`换成「${DAY_MODE_TRAIN[m].ja}」会按新档位重排今天还没做的模板任务，确定吗？`)) return;
                switchMode.mutate(m);
              }}
              options={DAY_MODES.map((m) => ({
                value: m,
                label: (
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: DAY_MODE_TRAIN[m].color }} />
                    <span lang="ja">{DAY_MODE_TRAIN[m].ja}</span>
                  </span>
                ),
              }))}
            />
            <Summary data={data} />
          </div>
          {switchMode.isError && <Notice tone="error" className="mt-3">{errorText(switchMode.error)}</Notice>}

          <RouteMap
            tasks={data.tasks}
            color={train.color}
            busyId={setStatus.isPending ? setStatus.variables?.task.id : undefined}
            onStatus={(task, status) => setStatus.mutate({ task, status })}
            onRemove={(task) => remove.mutate(task)}
          />

          <AddStop date={day} onAdded={() => qc.invalidateQueries({ queryKey: key })} />
        </>
      )}
    </div>
  );
}

/* ───────────── 主线：今日路线（v1.5.0） ───────────── */

const STEP_ICON = { review: Cards, video: Television, practice: PencilSimpleLine, quiz: Trophy } as const;

function MainRoute() {
  const q = useQuery({ queryKey: ['route-today'], queryFn: learnApi.route, staleTime: 0, refetchOnWindowFocus: true });
  const r = q.data;
  if (q.isError) return <Notice tone="error" className="mt-4">{errorText(q.error)}</Notice>;
  if (!r) return <Skeleton className="mt-4 h-64" />;
  const firstTodo = r.steps.findIndex((s) => !s.done);
  const allDone = firstTodo === -1;
  return (
    <section aria-label="今日主线" className="mt-4 rounded-2xl bg-surface px-3 py-3 lift sm:px-4">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-1">
        <h2 className="text-[15px] font-extrabold">今日主线</h2>
        <span className="font-sign text-xl font-semibold tabular">{r.doneCount}/{r.steps.length}</span>
      </div>
      {r.cardsSeeded > 0 && <p className="px-1 pb-1 text-xs text-ink-3">刚把 {r.cardsSeeded} 张课程词卡放进了复习。</p>}
      <ol className="relative">
        <span aria-hidden className="absolute bottom-6 left-5 top-6 w-1.5 -translate-x-1/2 rounded-full bg-surface-2 sm:left-6" />
        {r.steps.map((s, i) => (
          <RouteStepRow key={s.id} step={s} current={i === firstTodo} lessonTitle={lessonHeader(r, s, i)} />
        ))}
        <li className="flex items-center gap-3 py-3">
          <span className="grid w-10 shrink-0 place-items-center sm:w-12"><span className="relative size-3 rounded-sm bg-rail" /></span>
          <span className={cx('text-sm font-bold', allDone ? 'text-ok' : 'text-ink-3')}>
            <span lang="ja">終点</span> · {allDone ? '今天的主线走完了。……勉强及格。' : `还剩 ${r.steps.length - r.doneCount} 步`}
          </span>
        </li>
      </ol>
      {allDone && (
        <Link to="/learn" className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface-2 text-sm font-semibold hover:bg-go-soft">
          <BookOpenText className="size-4" /> 还有余力？去课程线路提前学下一站
        </Link>
      )}
    </section>
  );
}

/** 每课的第一步上方写课名 */
function lessonHeader(r: DailyRoute, s: RouteStep, i: number): string | null {
  if (!s.lessonId || r.steps[i - 1]?.lessonId === s.lessonId) return null;
  const l = r.lessons.find((x) => x.id === s.lessonId);
  return l ? `第 ${l.order} 站 · ${l.title}` : null;
}

function RouteStepRow({ step, current, lessonTitle }: { step: RouteStep; current: boolean; lessonTitle: string | null }) {
  const IconC = STEP_ICON[step.kind];
  return (
    <>
      {lessonTitle && <li className="relative py-1 pl-12 text-xs font-bold text-ink-3 sm:pl-14">{lessonTitle}</li>}
      <li>
        <Link to={step.link} viewTransition className={cx('relative flex items-center gap-3 rounded-xl py-2.5 pr-2 transition-colors hover:bg-surface-2', current && 'bg-go-soft/60')}>
          <span className="grid w-10 shrink-0 place-items-center sm:w-12">
            <span className={cx('grid size-6 place-items-center rounded-full ring-[3px] ring-go', step.done ? 'bg-go text-go-ink' : 'bg-surface')}>
              {step.done && <Check weight="bold" className="size-3.5" />}
            </span>
          </span>
          <IconC weight="duotone" className={cx('size-6 shrink-0', step.done ? 'text-ink-3' : 'text-ink-2')} />
          <span className="min-w-0 flex-1">
            <span className={cx('block text-[15px] font-bold leading-snug', step.done && 'text-ink-3')}>{step.title}</span>
            <span className="block truncate text-xs text-ink-3">{step.detail}{step.done ? '' : ` · 约 ${step.minutes} 分钟`}</span>
          </span>
          {step.done ? <CheckCircle weight="fill" className="size-5 shrink-0 text-ok" /> : <ArrowRight weight="bold" className={cx('size-4 shrink-0', current ? 'text-ink' : 'text-ink-3')} />}
        </Link>
      </li>
    </>
  );
}

/* ───────────── 站名牌 ───────────── */

function StationSign({ date, isToday, color, onColor, onPrev, onNext, onToday }: { date: string; isToday: boolean; color: string; onColor: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  return (
    <header className="overflow-hidden rounded-2xl bg-surface lift">
      <div className="px-4 pb-3 pt-4 text-center sm:px-6">
        <div className="text-xs font-semibold text-ink-3">{isToday ? '今天' : <button onClick={onToday} className="underline decoration-dotted">回到今天</button>} · 星期{WEEKDAY_ZH[weekdayOf(date)]}</div>
        <h1 lang="ja" className="mt-1 text-[28px] font-black leading-none tracking-tight sm:text-[34px]">{jaDate(date)}</h1>
      </div>
      {/* 站名牌下方的线路色带，左右写着前后两站 */}
      <div className="flex items-stretch text-[13px] font-semibold" style={{ background: color, color: onColor }}>
        <button onClick={onPrev} className="flex min-h-10 flex-1 items-center gap-1 px-3 text-left transition hover:brightness-110" aria-label="前一天">
          <CaretLeft weight="bold" className="size-4" />
          <span className="font-sign text-[15px]">{short(prev)}</span>
        </button>
        <span className="font-sign grid place-items-center px-3 text-[15px] opacity-90" aria-hidden>
          {short(date)}
        </span>
        <button onClick={onNext} className="flex min-h-10 flex-1 items-center justify-end gap-1 px-3 transition hover:brightness-110" aria-label="后一天">
          <span className="font-sign text-[15px]">{short(next)}</span>
          <CaretRight weight="bold" className="size-4" />
        </button>
      </div>
    </header>
  );
}

function Summary({ data }: { data: TodayResponse }) {
  const s = data.summary;
  const items = [
    { k: '站', v: `${s.done}/${s.total}` },
    { k: '计划', v: `${s.plannedMinutes}′` },
    { k: '已学', v: `${s.studiedMinutes}′` },
    { k: '待复习', v: String(s.dueCards) },
  ];
  return (
    <dl className="flex items-baseline gap-4">
      {items.map((i) => (
        <div key={i.k} className="text-right">
          <dt className="text-[11px] font-semibold text-ink-3">{i.k}</dt>
          <dd className="font-sign text-xl font-semibold leading-none tabular">{i.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ───────────── 线路图 ───────────── */

function RouteMap({
  tasks,
  color,
  busyId,
  onStatus,
  onRemove,
}: {
  tasks: Task[];
  color: string;
  busyId?: string;
  onStatus: (t: Task, s: Task['status']) => void;
  onRemove: (t: Task) => void;
}) {
  const sorted = useMemo(() => [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)), [tasks]);
  const listRef = useRef<HTMLOListElement>(null);
  const [geo, setGeo] = useState<{ centers: number[]; terminal: number }>({ centers: [], terminal: 0 });

  // 量出每一站圆点的中心，用来画已行驶的轨道和列车位置
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const center = (n: Element) => {
        const r = n.getBoundingClientRect();
        return r.top - top + r.height / 2;
      };
      const centers = Array.from(el.querySelectorAll('[data-stop]')).map(center);
      const end = el.querySelector('[data-terminal]');
      setGeo({ centers, terminal: end ? center(end) : centers.at(-1) ?? 0 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sorted.length]);

  if (!sorted.length) {
    return (
      <Card className="mt-5">
        <EmptyState icon={TrainSimple} title="这一天还没有站点">
          在设置里配好任务模板，或者在下面手动加一站。
        </EmptyState>
      </Card>
    );
  }

  const passed = (t: Task) => t.status !== 'todo';
  const firstTodo = sorted.findIndex((t) => !passed(t));
  const allDone = firstTodo === -1;
  const at = allDone ? geo.centers.length : firstTodo;
  const first = geo.centers[0] ?? 0;
  const terminal = geo.terminal;
  const travelled = at > 0 ? geo.centers[Math.min(at, geo.centers.length) - 1] ?? first : first;
  const trainY = geo.centers[at] ?? first;

  return (
    <section aria-label="今日线路" className="relative mt-5 rounded-2xl bg-surface px-3 py-3 lift sm:px-4">
      <ol ref={listRef} className="relative stagger">
        {/* 轨道：从第一站铺到终点；已行驶的部分用列车颜色覆盖 */}
        <span aria-hidden className="absolute left-5 w-1.5 -translate-x-1/2 rounded-full bg-surface-2 sm:left-6" style={{ top: first, height: Math.max(0, terminal - first) }} />
        <span
          aria-hidden
          className="absolute left-5 w-1.5 -translate-x-1/2 rounded-full transition-[height] duration-700 ease-[var(--ease-out-expo)] motion-reduce:transition-none sm:left-6"
          style={{ top: first, height: Math.max(0, (allDone ? terminal : travelled) - first), background: color }}
        />
        {/* 列车：停在下一个要去的站，全部完成时停在终点 */}
        {geo.centers.length > 0 && (
          <span
            aria-hidden
            className="absolute left-5 z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-white shadow-md transition-[top] duration-700 ease-[var(--ease-out-expo)] motion-reduce:transition-none sm:left-6"
            style={{ top: allDone ? terminal : trainY, background: color }}
          >
            {allDone ? <FlagCheckered weight="fill" className="size-4" /> : <TrainSimple weight="fill" className="size-4" />}
          </span>
        )}

        {sorted.map((t, i) => (
          <Stop key={t.id} task={t} index={i + 1} color={color} current={i === firstTodo} busy={busyId === t.id} onStatus={onStatus} onRemove={onRemove} />
        ))}
        <li className="flex items-center gap-3 py-3">
          <span className="grid w-10 shrink-0 place-items-center sm:w-12" data-terminal>
            <span className="size-3 rounded-sm bg-rail" />
          </span>
          <span className={cx('text-sm font-bold', allDone ? 'text-ok' : 'text-ink-3')}>
            <span lang="ja">終点</span> · {allDone ? '今天的路线全部跑完了' : `还剩 ${sorted.length - sorted.filter(passed).length} 站`}
          </span>
        </li>
      </ol>
    </section>
  );
}

function Stop({
  task,
  index,
  color,
  current,
  busy,
  onStatus,
  onRemove,
}: {
  task: Task;
  index: number;
  color: string;
  current: boolean;
  busy: boolean;
  onStatus: (t: Task, s: Task['status']) => void;
  onRemove: (t: Task) => void;
}) {
  const line = lineOf(task.module);
  const done = task.status === 'done';
  const skipped = task.status === 'skipped';
  const [menu, setMenu] = useState(false);
  const target = [task.targetMinutes && `${task.targetMinutes} 分钟`, task.targetCount && `${task.targetCount} 个`].filter(Boolean).join(' · ');

  return (
    <li className={cx('relative flex items-center gap-3 rounded-xl py-2.5 pr-1 transition-colors', current && 'bg-go-soft/60')}>
      {/* 站点圆点 */}
      <span className="grid w-10 shrink-0 place-items-center sm:w-12" data-stop>
        <span
          className={cx('size-4 rounded-full ring-[3px] transition-[background-color] duration-300', done && 'animate-[stamp_360ms_var(--ease-out-expo)]')}
          style={{ background: done ? color : 'var(--surface)', boxShadow: `0 0 0 3px ${skipped ? 'var(--rail)' : color}` }}
        />
      </span>
      <LineBadge line={line} number={index} size="sm" />
      <div className={cx('min-w-0 flex-1', skipped && 'opacity-50')}>
        <div className={cx('line-clamp-2 text-[15px] font-bold leading-snug', done && 'text-ink-3 line-through decoration-2')} style={done ? { textDecorationColor: color } : undefined}>
          {task.title}
        </div>
        <div className="truncate text-xs text-ink-3">
          {line.name}
          {target && ` · ${target}`}
          {skipped && ' · 已跳过'}
        </div>
      </div>
      {line.to && !done && (
        <Link to={line.to} viewTransition className="hidden min-h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink sm:inline-flex">
          去练习 <ArrowRight weight="bold" className="size-3.5" />
        </Link>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onStatus(task, done ? 'todo' : 'done')}
        aria-pressed={done}
        aria-label={done ? `撤销完成：${task.title}` : `完成：${task.title}`}
        className={cx(
          'grid size-11 shrink-0 place-items-center rounded-xl transition duration-150 active:scale-95',
          done ? 'text-white' : 'bg-surface-2 text-ink-3 hover:text-ink',
        )}
        style={done ? { background: color } : undefined}
      >
        <Check weight="bold" className="size-5" />
      </button>
      <div className="relative">
        <IconButton icon={DotsThreeVertical} label="更多操作" onClick={() => setMenu((v) => !v)} aria-expanded={menu} />
        {menu && (
          <div className="absolute right-0 top-12 z-20 w-40 overflow-hidden rounded-xl bg-surface py-1 lift ring-1 ring-line" onMouseLeave={() => setMenu(false)}>
            {line.to && (
              <Link to={line.to} className="flex min-h-10 items-center gap-2 px-3 text-sm hover:bg-surface-2 sm:hidden">
                <ArrowRight className="size-4" /> 去练习
              </Link>
            )}
            <button className="flex min-h-10 w-full items-center gap-2 px-3 text-sm hover:bg-surface-2" onClick={() => { setMenu(false); onStatus(task, skipped ? 'todo' : 'skipped'); }}>
              <SkipForward className="size-4" /> {skipped ? '恢复' : '跳过这站'}
            </button>
            <button className="flex min-h-10 w-full items-center gap-2 px-3 text-sm text-danger hover:bg-danger-soft" onClick={() => { setMenu(false); onRemove(task); }}>
              <Trash className="size-4" /> 删除
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/* ───────────── 加一站 ───────────── */

function AddStop({ date, onAdded }: { date: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [module, setModule] = useState<StudyModule>('other');
  const [minutes, setMinutes] = useState('');
  const add = useMutation({
    mutationFn: () => tasksApi.create({ title: title.trim(), module, date, targetMinutes: minutes ? Number(minutes) : null }),
    onSuccess: () => {
      setTitle('');
      setMinutes('');
      setOpen(false);
      onAdded();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) add.mutate();
  }
  if (!open) {
    return (
      <Button variant="ghost" icon={Plus} className="mt-3" onClick={() => setOpen(true)}>
        加一站
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-2xl bg-surface p-4 lift sm:grid-cols-[1fr_160px_110px_auto] sm:items-end">
      <Input autoFocus placeholder="例如：复习第 5 课单词" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="任务名" />
      <Select value={module} onChange={(e) => setModule(e.target.value as StudyModule)} aria-label="所属模块">
        {STUDY_MODULES.map((m) => <option key={m} value={m}>{lineOf(m).name}</option>)}
      </Select>
      <Input inputMode="numeric" placeholder="分钟" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="目标分钟" />
      <div className="flex gap-2">
        <Button type="submit" loading={add.isPending} disabled={!title.trim()}>添加</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>取消</Button>
      </div>
      {add.isError && <Notice tone="error" className="sm:col-span-4">{add.error instanceof ApiError ? add.error.message : errorText(add.error)}</Notice>}
    </form>
  );
}

