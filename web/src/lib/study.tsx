/**
 * 各练习页共用的小部件：设置、学习计时、日期、带读音的日文、朗读按钮。
 */
import { SpeakerHigh, SpeakerSimpleX } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FuriganaMode, StudyModule, Weekday } from '@shared/constants';
import type { SettingsData } from '@shared/types';
import { learnApi, settingsApi, statsApi } from '@/api/endpoints';
import { cx } from '@/components/ui';
import { speech } from '@/platform/speech';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, staleTime: 5 * 60_000 });
}

export function useSettingsData(): SettingsData | undefined {
  return useSettings().data?.data;
}

/** 少于这个时长不记：点进来看一眼就走不算学习 */
const MIN_LOG_MS = 20_000;

/**
 * 页面可见期间计时，离开页面或切到后台时上报一段 time-log。
 * 统计里"各模块时长"就靠它。上报失败不打扰用户。
 */
export function useStudyTimer(module: StudyModule) {
  useEffect(() => {
    let started = document.visibilityState === 'visible' ? new Date() : null;
    const flush = () => {
      if (!started) return;
      const ms = Date.now() - started.getTime();
      if (ms >= MIN_LOG_MS) void statsApi.logTime(module, started, Math.min(ms, 3 * 3600_000)).catch(() => undefined);
      started = null;
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
      else started = new Date();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [module]);
}

/* ───────────── 日期 ───────────── */

export function todayIn(tz: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const WEEKDAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_JA: Record<Weekday, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
export const WEEKDAY_ZH: Record<Weekday, string> = { mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六', sun: '日' };

export function weekdayOf(iso: string): Weekday {
  return WEEKDAY_ORDER[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
}

/** 10月29日（水） */
export function jaDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日（${WEEKDAY_JA[weekdayOf(iso)]}）`;
}

/* ───────────── 学习阶段（v1.6.0） ───────────── */

/** 当前学习阶段与"已学过"的材料；各练习模块据此调整难度。过关后会被刷新 */
export function useStage() {
  return useQuery({ queryKey: ['stage'], queryFn: learnApi.stage, staleTime: 5 * 60_000 }).data;
}

/** 五十音和 N5 阶段算初学：注音一律常显 */
export const isBeginner = (stage?: string) => stage === 'kana' || stage === 'N5';

/* ───────────── 日文与读音 ───────────── */

/**
 * 日文 + 读音。按设置里的注音模式：always 常显；unknownOnly 点一下显示；never 不显示。
 * 读音与原文相同（全是假名）时不重复显示。
 */
export function JaText({
  text,
  reading,
  mode,
  className,
  readingClassName,
}: {
  text: string;
  reading?: string | null;
  mode?: FuriganaMode;
  className?: string;
  readingClassName?: string;
}) {
  const [shown, setShown] = useState(false);
  const stage = useStage()?.stage;
  const has = !!reading && reading !== text;
  // 初学阶段（五十音、N5）汉字一律带注音，除非用户明确关掉了
  const effective = isBeginner(stage) && mode !== 'never' ? 'always' : (mode ?? 'unknownOnly');
  const visible = has && (effective === 'always' || (effective === 'unknownOnly' && shown));
  return (
    <span className={cx('inline-block', className)}>
      {has && effective !== 'never' && (
        <span
          lang="ja"
          aria-hidden={!visible}
          className={cx(
            'block text-[0.62em] leading-tight tracking-wide text-ink-3 transition-[opacity,filter] duration-200',
            visible ? 'opacity-100' : 'select-none opacity-0 blur-[3px]',
            readingClassName,
          )}
        >
          {reading}
        </span>
      )}
      <span
        lang="ja"
        onClick={has && effective === 'unknownOnly' ? () => setShown((v) => !v) : undefined}
        className={cx(has && effective === 'unknownOnly' && 'cursor-pointer')}
        title={has && effective === 'unknownOnly' ? '点一下显示读音' : undefined}
      >
        {text}
      </span>
    </span>
  );
}

/** 朗读按钮：用设置里的语速和声音；再按一次停止 */
export function SpeakButton({ text, className, label = '朗读' }: { text: string; className?: string; label?: string }) {
  const settings = useSettingsData();
  const [playing, setPlaying] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  async function toggle() {
    if (playing) {
      await speech.stop();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    try {
      await speech.speak(text, { rate: settings?.speechRate ?? 1, voiceName: settings?.ttsVoice ?? null });
    } finally {
      if (alive.current) setPlaying(false);
    }
  }
  const IconC = playing ? SpeakerSimpleX : SpeakerHigh;
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={playing ? '停止朗读' : label}
      title={playing ? '停止朗读' : label}
      className={cx(
        'inline-grid size-10 shrink-0 place-items-center rounded-full transition duration-150 active:scale-95',
        playing ? 'bg-go text-go-ink [animation:pulse-ring_1.2s_ease-out_infinite]' : 'bg-surface-2 text-ink-2 hover:text-ink',
        className,
      )}
    >
      <IconC weight="fill" className="size-5" />
    </button>
  );
}
