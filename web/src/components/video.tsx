/**
 * B 站外链播放器（契约 §15）。播放器是 B 站的跨源页面，读不到真实播放位置，
 * 所以"续播"用估算：点了播放后，页面在前台时逐秒累计；每 20 秒存一次；下次从这里接着放。
 * 中途暂停了可以点"我暂停了"停止计时，免得估算跑过头；接近片尾自动记为看完。
 */
import { ArrowSquareOut, CheckCircle, Pause, Play, Rewind } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { videoApi } from '@/api/endpoints';
import { Button, cx } from './ui';

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const SAVE_EVERY = 20;
const DONE_TAIL = 30;

export function BiliPlayer({
  courseId,
  bvid,
  page,
  title,
  durationSec,
  savedSec,
  completed,
}: {
  courseId: string;
  bvid: string;
  page: number;
  title: string;
  durationSec: number;
  savedSec: number;
  completed: boolean;
}) {
  const qc = useQueryClient();
  // 看完的从头放；没看完的倒退 5 秒接上
  const [start, setStart] = useState(completed ? 0 : Math.max(0, savedSec - 5));
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(start);
  const [done, setDone] = useState(completed);
  const lastSaved = useRef(savedSec);

  const save = useMutation({
    mutationFn: (v: { positionSec: number; completed?: boolean }) => videoApi.progress(courseId, page, v.positionSec, v.completed),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['video-course', courseId] });
      void qc.invalidateQueries({ queryKey: ['video-courses'] });
    },
  });
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;

  // 页面在前台、已开始播放、没有手动暂停时逐秒累计
  useEffect(() => {
    if (!playing || paused) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setPos((p) => Math.min(durationSec, p + 1));
    }, 1000);
    return () => clearInterval(t);
  }, [playing, paused, durationSec]);

  useEffect(() => {
    if (!playing) return;
    const near = pos >= durationSec - DONE_TAIL;
    if (near && !done) {
      setDone(true);
      saveRef.current({ positionSec: Math.floor(pos), completed: true });
      lastSaved.current = pos;
    } else if (pos - lastSaved.current >= SAVE_EVERY) {
      saveRef.current({ positionSec: Math.floor(pos) });
      lastSaved.current = pos;
    }
  }, [pos, playing, done, durationSec]);

  // 离开页面时补存一次
  useEffect(
    () => () => {
      if (pos > lastSaved.current + 3) saveRef.current({ positionSec: Math.floor(pos) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在卸载时
    [],
  );

  const src = `https://player.bilibili.com/player.html?bvid=${bvid}&p=${page}&t=${Math.floor(start)}&autoplay=1&high_quality=1&danmaku=0`;

  return (
    <div>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black lift">
        {playing ? (
          <iframe
            key={`${page}-${start}`}
            src={src}
            title={title}
            className="absolute inset-0 size-full"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,#1d2530,#0d1117)] p-4 text-center text-white">
            <div>
              <p className="mb-1 text-xs font-semibold text-white/60">第 {page} 集 · {fmtTime(durationSec)}</p>
              <p className="mb-4 line-clamp-2 font-bold">{title}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={Play} onClick={() => { setPos(start); setPlaying(true); }}>
                  {start > 10 ? `从 ${fmtTime(start)} 继续` : '开始播放'}
                </Button>
                {start > 10 && <Button variant="secondary" icon={Rewind} onClick={() => { setStart(0); setPos(0); setPlaying(true); }}>从头看</Button>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className={cx('flex-1', done && 'font-semibold text-ok')}>
          {done ? '本集已看完' : playing ? `已记录约 ${fmtTime(pos)} / ${fmtTime(durationSec)}（估算：从你点播放开始计时）` : savedSec > 0 ? `上次看到约 ${fmtTime(savedSec)}` : '还没看过'}
        </span>
        {playing && !done && (
          <button onClick={() => setPaused((v) => !v)} className={cx('inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-semibold', paused ? 'bg-go-soft text-ok' : 'hover:bg-surface-2')}>
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? '继续计时' : '我暂停了'}
          </button>
        )}
        {!done && (
          <button
            onClick={() => { setDone(true); save.mutate({ positionSec: durationSec, completed: true }); }}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-semibold hover:bg-surface-2"
          >
            <CheckCircle className="size-3.5" /> 标记看完
          </button>
        )}
        <a href={`https://www.bilibili.com/video/${bvid}?p=${page}`} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-semibold hover:bg-surface-2">
          <ArrowSquareOut className="size-3.5" /> 播不了？去 B 站看
        </a>
      </div>
    </div>
  );
}
