/**
 * 视频课程：B 站合集（200 集）嵌在软件里。可以选任意一集；顶部"继续上次"直接接着看；
 * 每集显示看到哪里、是否看完、对应哪一课。
 */
import { CheckCircle, ListBullets, Play } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { VideoEpisode } from '@shared/types';
import { videoApi } from '@/api/endpoints';
import { BiliPlayer, fmtTime } from '@/components/video';
import { Card, Notice, PageHeader, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { useStudyTimer } from '@/lib/study';

const LINE = lineOf('course');

export function VideosPage() {
  useStudyTimer('course');
  const { id = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const q = useQuery({ queryKey: ['video-course', id], queryFn: () => videoApi.course(id) });
  const c = q.data;
  const page = Number(search.get('p')) || c?.lastPage || 2;
  const ep = c?.episodes.find((e) => e.page === page);
  const [section, setSection] = useState<string | null>(null);
  const sections = useMemo(() => [...new Set(c?.episodes.map((e) => e.section) ?? [])], [c]);
  const shownSection = section ?? ep?.section ?? sections[0];
  const playerRef = useRef<HTMLDivElement>(null);

  const pick = (p: number) => {
    setSearch({ p: String(p) }, { replace: true });
    playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  useEffect(() => {
    if (ep && !section) setSection(ep.section);
  }, [ep, section]);

  return (
    <div>
      <PageHeader line={LINE} back="/courses" title={c?.title ?? '视频课程'} subtitle={c ? `${c.author} · ${c.episodeCount} 集 · 约 ${Math.round(c.totalMinutes / 60)} 小时 · 已看完 ${c.completedCount} 集` : undefined} />
      {q.isError ? (
        <Notice tone="error">{errorText(q.error)}</Notice>
      ) : !c || !ep ? (
        <Skeleton className="aspect-video" />
      ) : (
        <>
          <div ref={playerRef} className="scroll-mt-4">
            <BiliPlayer key={ep.page} courseId={c.id} bvid={c.bvid} page={ep.page} title={ep.title} durationSec={ep.durationSec} savedSec={ep.progress?.positionSec ?? 0} completed={ep.progress?.completed ?? false} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">第 {ep.page} 集 · {ep.title}</span>
            {ep.lessonId && <Link to={`/learn/${ep.lessonId}`} className="rounded-md bg-go-soft px-2 py-0.5 text-xs font-semibold text-ok">配套课程：讲解与练习 →</Link>}
          </div>

          <div className="-mx-1 mb-3 mt-6 flex gap-2 overflow-x-auto px-1 pb-1">
            {sections.map((s) => {
              const eps = c.episodes.filter((e) => e.section === s);
              return (
                <button key={s} onClick={() => setSection(s)} className={cx('min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold', shownSection === s ? 'bg-ink text-ground' : 'bg-surface ring-1 ring-line')}>
                  {s} <span className="font-sign opacity-70">{eps.filter((e) => e.progress?.completed).length}/{eps.length}</span>
                </button>
              );
            })}
          </div>
          <Card padded={false}>
            <ul>
              {c.episodes.filter((e) => e.section === shownSection).map((e, i) => (
                <EpisodeRow key={e.page} e={e} first={i === 0} active={e.page === ep.page} onPick={() => pick(e.page)} />
              ))}
            </ul>
          </Card>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
            <ListBullets className="size-3.5" />
            视频由 B 站官方播放器播放，不下载、不转存。观看进度是估算的（播放器不对外报告时间），可以随时"标记看完"。
          </p>
        </>
      )}
    </div>
  );
}

function EpisodeRow({ e, first, active, onPick }: { e: VideoEpisode; first: boolean; active: boolean; onPick: () => void }) {
  const pct = e.progress ? Math.min(1, e.progress.positionSec / e.durationSec) : 0;
  return (
    <li className={cx(!first && 'border-t border-line')}>
      <button onClick={onPick} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors', active ? 'bg-go-soft/60' : 'hover:bg-surface-2/60')}>
        <span className="font-sign w-9 shrink-0 text-sm font-bold tabular text-ink-3">{e.page}</span>
        <div className="min-w-0 flex-1">
          <div className={cx('truncate text-[14px]', active ? 'font-bold' : 'font-semibold')}>{e.title}</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${(e.progress?.completed ? 1 : pct) * 100}%`, background: LINE.color }} />
            </div>
            <span className="font-sign w-10 text-right text-[11px] text-ink-3">{fmtTime(e.durationSec)}</span>
          </div>
        </div>
        {e.progress?.completed ? <CheckCircle weight="fill" className="size-5 shrink-0 text-ok" aria-label="看完" /> : active ? <Play weight="fill" className="size-5 shrink-0" style={{ color: LINE.color }} /> : <span className="size-5" />}
      </button>
    </li>
  );
}
