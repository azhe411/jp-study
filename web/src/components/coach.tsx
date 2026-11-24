/**
 * 学习教练卡片（契约 v1.5.0 §20）：今日页顶部的每日小结 / 每周回顾、课程小测后的本课小结。
 * 不需要用户提问 —— 打开页面就有；生成要几秒，期间显示骨架。
 */
import { ArrowRight, ArrowsClockwise, CheckCircle, Sparkle } from '@phosphor-icons/react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { CoachAction } from '@shared/constants';
import type { CoachNote, CoachSuggestion } from '@shared/types';
import { coachApi } from '@/api/endpoints';
import claudia from '@/assets/claudia-bust.webp';
import { Skeleton, cx } from './ui';

export function coachLink(s: CoachSuggestion): string {
  const id = s.lessonId;
  if (s.restudy) return s.restudy === 'hard' ? '/review/restudy?hard=1' : s.restudy === 'lesson' && id ? `/review/restudy?lesson=${id}` : '/review/restudy';
  const map: Record<CoachAction, string> = {
    review: '/review',
    lesson: id ? `/learn/${id}` : '/learn',
    practice: id ? `/learn/${id}/practice` : '/learn',
    mistakes: '/mistakes',
    talk: id ? `/talk?scenario=lesson:${id}` : '/talk',
    speaking: '/speaking',
    listening: '/listening',
    videos: '/videos',
    plan: '/onboarding',
  };
  return map[s.action];
}

const KIND_LABEL = { daily: '今日小结', lesson: '本站小结', weekly: '本周回顾', live: '实时点评' } as const;

/** 主页的实时点评：回到页面就刷新；后台正在重写时过几秒再取一次，新点评自己换上来 */
export function LiveCoach({ className }: { className?: string }) {
  const q = useQuery({
    queryKey: ['coach', 'live'],
    queryFn: coachApi.live,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (s) => (s.state.data?.refreshing ? 6000 : false),
  });
  return <CoachView q={q} className={className} />;
}

export function CoachCard({ queryKey, load, className }: { queryKey: unknown[]; load: () => Promise<CoachNote>; className?: string }) {
  const q = useQuery({ queryKey, queryFn: load, staleTime: 10 * 60_000, retry: 1 });
  return <CoachView q={q} className={className} />;
}

function CoachView({ q, className }: { q: UseQueryResult<CoachNote>; className?: string }) {
  const note = q.data;
  useEffect(() => {
    if (note && !note.readAt) void coachApi.read(note.id).catch(() => undefined);
  }, [note]);

  // 离线或出错：安静地不显示，不打扰学习
  if (q.isError) return null;
  if (!note) {
    return (
      <section className={cx('rounded-2xl bg-surface p-4 lift', className)} aria-busy="true">
        <p className="mb-3 flex items-center gap-2 text-sm text-ink-3"><Sparkle className="size-4 animate-pulse" />克劳迪娅正在看您的学习记录…</p>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="mt-2 h-4" />
        <Skeleton className="mt-1 h-4 w-5/6" />
      </section>
    );
  }
  // 做完的沉到下面：还没做的第一条才是"现在最该做的"
  const rank = (s: CoachSuggestion) => (s.status === 'done' ? 1 : 0);
  const suggestions = [...note.suggestions].sort((a, b) => rank(a) - rank(b));
  const firstOpen = suggestions.findIndex((s) => s.status !== 'done');
  return (
    <section className={cx('relative overflow-hidden rounded-2xl bg-surface p-4 sm:p-5 lift', className)} aria-label={KIND_LABEL[note.kind]}>
      {/* 克劳迪娅靠在右上角；下沿在图里已经淡出，压在下面的内容上也不突兀 */}
      <img src={claudia} alt="" aria-hidden="true" draggable={false} className="pointer-events-none absolute -right-3 -top-1 h-[9.5rem] w-auto select-none sm:right-1" />
      <div className="relative min-h-[7.5rem] pr-[6.5rem] sm:pr-32">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-ink-3">
          <Sparkle weight="fill" className="size-4 text-go" />
          <span>{KIND_LABEL[note.kind]} · {note.source === 'rules' ? '按固定规则生成，未使用 AI' : '克劳迪娅'}</span>
          {note.refreshing && <span className="ml-auto animate-pulse">正在看您刚才学的……</span>}
          {!note.refreshing && note.source === 'rules' && <Link to="/settings" className="ml-auto underline">填 AI Key 后点评更具体</Link>}
      </div>
      <h2 className="mt-1.5 text-lg font-black">{note.title}</h2>
      <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{note.summary}</p>
      </div>
      {note.highlights.length > 0 && (
        <ul className="relative mt-3 space-y-1.5">
          {note.highlights.map((h, i) => (
            <li key={i} className="flex gap-2 text-sm"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink-3" />{h}</li>
          ))}
        </ul>
      )}
      {note.sections && note.sections.length > 0 && (
        <div className="relative mt-4 space-y-3">
          {note.sections.map((s, i) => (
            <div key={i}>
              <h3 className="text-sm font-bold">{s.title}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{s.body}</p>
            </div>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="relative mt-4 grid gap-2">
          {suggestions.map((s, i) => {
            const done = s.status === 'done';
            const primary = i === firstOpen;
            const sub = primary ? 'text-go-ink/80' : 'text-ink-3';
            return (
              <Link
                key={i}
                to={coachLink(s)}
                className={cx(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 transition active:scale-[0.99]',
                  primary ? 'bg-go text-go-ink' : done ? 'bg-surface-2 opacity-70' : 'bg-surface-2 hover:bg-go-soft',
                )}
              >
                {done && <CheckCircle weight="fill" className="size-5 shrink-0 text-ok" aria-label="已完成" />}
                {s.status === 'retry' && <ArrowsClockwise weight="bold" className="size-5 shrink-0" aria-label="没达标，再来一次" />}
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-[15px] font-semibold', done && 'line-through')}>{s.text}</span>
                  {!done && s.detail && <span className={cx('mt-0.5 block text-[13px] leading-snug', sub)}>{s.detail}</span>}
                  {s.result && <span className={cx('mt-0.5 block text-[13px] font-semibold leading-snug', sub)}>{s.result}</span>}
                </span>
                {!done && <ArrowRight weight="bold" className="size-4 shrink-0" />}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
