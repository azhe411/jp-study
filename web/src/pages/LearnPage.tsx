/**
 * 课程线路：从入门到目标，每课一站。顶部是计划进度（到站数、预计到站日、落后提醒），
 * 下面按区段（入门 / 假名 / N5 … N1）排出站点：已过关、可学、未解锁。
 */
import { CheckCircle, Lock, MapPin, Play, SlidersHorizontal, TrainSimple } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CURRICULUM_PARTS, STUDY_GOAL_LABELS, type CurriculumPart } from '@shared/constants';
import type { LessonSummary, PlanToday } from '@shared/types';
import { learnApi } from '@/api/endpoints';
import { Card, Notice, PageHeader, Rail, Skeleton, cx, errorText } from '@/components/ui';
import { rescheduleReminders } from '@/lib/notify';

export const PART_LABEL: Record<CurriculumPart, string> = {
  guide: '入门', kana: '假名与发音', N5: 'N5 · 初级上', N4: 'N4 · 初级下', N3: 'N3 · 中级', N2: 'N2', N1: 'N1',
};
const PART_COLOR: Record<CurriculumPart, string> = {
  guide: '#8a929b', kana: '#e85298', N5: '#80c241', N4: '#f39700', N3: '#00a7db', N2: '#9b7cb6', N1: '#e60012',
};

/** 今年的日期不写年份：到站日可能在几年后，必须写清楚 */
const fmt = (d: string) => `${d.slice(0, 4) === String(new Date().getFullYear()) ? '' : `${d.slice(0, 4)} 年 `}${Number(d.slice(5, 7))} 月 ${Number(d.slice(8))} 日`;

export function usePlanToday() {
  const q = useQuery({ queryKey: ['plan-today'], queryFn: learnApi.today, staleTime: 60_000 });
  // 每次拿到新进度，顺手重排提醒（学过了今天就不再打扰）
  useEffect(() => {
    if (q.data) void rescheduleReminders(q.data);
  }, [q.data]);
  return q;
}

export function PlanBanner({ t, compact }: { t: PlanToday; compact?: boolean }) {
  const p = t.plan;
  const next = t.nextLessons[0];
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
        {/* 给足基准宽度：写 flex-1 的话基准是 0，放不下也不会换行，文字会被挤成一列 */}
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="flex items-baseline gap-2">
            <span className="font-sign text-3xl font-bold tabular">{t.passedCount}</span>
            <span className="text-sm text-ink-3">/ {t.totalCount} 站{p ? ` · 目标 ${STUDY_GOAL_LABELS[p.goal]}` : ''}</span>
          </div>
          <Rail value={t.totalCount ? t.passedCount / t.totalCount : 0} className="mt-2" label="课程进度" />
          <p className="mt-2 text-sm text-ink-2">
            {!p
              ? '还没有学习计划：制定一个，系统会每天告诉你学哪一课。'
              : t.passedCount >= t.totalCount
                ? '整条线路都走完了。'
                : t.behindBy >= 2
                  ? `比计划落后 ${t.behindBy} 站，今天多学一课就能追上。按现在的速度预计 ${fmt(t.projectedFinish!)} 到站。`
                  : t.behindBy <= -2
                    ? `比计划提前 ${-t.behindBy} 站。预计 ${fmt(t.projectedFinish!)} 到站，期限是 ${fmt(p.targetDate)}。`
                    : `按计划进行中。预计 ${fmt(t.projectedFinish!)} 到站，期限是 ${fmt(p.targetDate)}。`}
          </p>
          {p && t.projectedFinish && t.passedCount < t.totalCount && t.projectedFinish > p.targetDate && (
            <p className="mt-1 text-sm font-semibold text-danger">
              按每天 {p.dailyMinutes} 分钟赶不上期限。<Link to="/onboarding" className="underline">调整计划</Link>
            </p>
          )}
        </div>
        {next && (
          <Link to={`/learn/${next.id}`} viewTransition className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-go px-4 font-bold text-go-ink transition active:scale-[0.98] sm:w-auto">
            <Play weight="fill" className="size-4" />
            {compact ? '学下一课' : '继续：'}{!compact && <span className="min-w-0 truncate">{next.title}</span>}
          </Link>
        )}
        {!p && (
          <Link to="/onboarding" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-go px-4 font-bold text-go-ink sm:w-auto">
            <TrainSimple weight="fill" className="size-4" /> 制定学习计划
          </Link>
        )}
      </div>
    </Card>
  );
}

export function LearnPage() {
  const today = usePlanToday();
  const list = useQuery({ queryKey: ['curriculum'], queryFn: () => learnApi.curriculum() });
  const items = list.data?.items ?? [];
  const current = items.find((l) => l.status === 'available') ?? items[0];
  const [part, setPart] = useState<CurriculumPart | null>(null);
  const shown = part ?? current?.part ?? 'guide';
  const inPart = useMemo(() => items.filter((l) => l.part === shown), [items, shown]);

  return (
    <div>
      <PageHeader
        title="课程"
        subtitle="按《新标准日本语》课序：看视频 → 读讲解 → 做练习 → 过关到站"
        actions={<Link to="/onboarding" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-ink-2 ring-1 ring-line hover:text-ink"><SlidersHorizontal className="size-4" />调整计划</Link>}
      />
      {today.data && <PlanBanner t={today.data} />}

      <div className="-mx-1 mb-4 mt-5 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="区段">
        {CURRICULUM_PARTS.map((p) => {
          const all = items.filter((l) => l.part === p);
          const passed = all.filter((l) => l.status === 'passed').length;
          return (
            <button
              key={p}
              role="tab"
              aria-selected={shown === p}
              onClick={() => setPart(p)}
              className={cx('flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition', shown === p ? 'bg-ink text-ground' : 'bg-surface text-ink-2 ring-1 ring-line')}
            >
              <span className="size-2 rounded-full" style={{ background: PART_COLOR[p] }} />
              {PART_LABEL[p]}
              {all.length > 0 && <span className="font-sign text-[11px] opacity-70">{passed}/{all.length}</span>}
            </button>
          );
        })}
      </div>

      {list.isError ? (
        <Notice tone="error">{errorText(list.error)}</Notice>
      ) : list.isPending ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <ol className="stagger relative space-y-1.5">
          {inPart.map((l) => <StationRow key={l.id} l={l} color={PART_COLOR[l.part]} current={l.id === current?.id} />)}
        </ol>
      )}
    </div>
  );
}

function StationRow({ l, color, current }: { l: LessonSummary; color: string; current: boolean }) {
  const locked = l.status === 'locked';
  const passed = l.status === 'passed';
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold" style={passed ? { background: color, color: '#fff' } : { boxShadow: `inset 0 0 0 2.5px ${locked ? 'var(--rail)' : color}`, color: locked ? 'var(--ink-3)' : 'var(--ink)' }}>
        {passed ? <CheckCircle weight="bold" className="size-5" /> : locked ? <Lock className="size-4" /> : <span className="font-sign">{l.order}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cx('font-bold', locked && 'text-ink-3')}>{l.title}</div>
        <div className="truncate text-xs text-ink-3">{l.goal} · 约 {l.minutes} 分钟{l.videos.length ? ` · ${l.videos.length} 集视频` : ''}</div>
      </div>
      {l.bestScore !== null && <span className="font-sign text-lg font-bold tabular" style={{ color: passed ? color : 'var(--ink-3)' }}>{l.bestScore}</span>}
      {current && !passed && <MapPin weight="fill" className="size-5 shrink-0" style={{ color }} aria-label="当前站" />}
    </>
  );
  return (
    <li>
      {locked ? (
        <div className="flex min-h-16 items-center gap-3 rounded-2xl bg-surface/60 px-3 py-2 opacity-80" title="先通过前面的课程">{body}</div>
      ) : (
        <Link to={`/learn/${l.id}`} viewTransition className={cx('flex min-h-16 items-center gap-3 rounded-2xl bg-surface px-3 py-2 lift transition hover:-translate-y-0.5', current && 'ring-2 ring-go')}>
          {body}
        </Link>
      )}
    </li>
  );
}

