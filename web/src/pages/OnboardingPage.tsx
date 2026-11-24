/**
 * 开站向导：一屏一个问题，假设用户什么都不懂。
 *   现在的水平 → 目标 → 截止日期 → 每天多久 → 几点提醒 → 估算结论（来得及 / 怎么调整）→ 出发
 * 设置页可以再次进入（重新规划），会带上已有的计划。
 */
import { ArrowLeft, ArrowRight, Bell, CheckCircle, TrainSimple, Warning } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STUDY_GOAL_LABELS, type StartLevel, type StudyGoal } from '@shared/constants';
import type { PlanPreview, StudyPlanInput } from '@shared/types';
import { ApiError } from '@/api/client';
import { learnApi } from '@/api/endpoints';
import { Button, Input, Notice, Rail, Switch, cx, errorText } from '@/components/ui';
import { remindersSupported, rescheduleReminders } from '@/lib/notify';
import { addDays, todayIn, useSettingsData } from '@/lib/study';
import { platform } from '@/platform';

export const ONBOARDED_KEY = 'jp.onboarded';

const LEVELS: Array<{ value: StartLevel; title: string; desc: string }> = [
  { value: 'zero', title: '完全零基础', desc: 'あいうえお 都不认识。没关系，从第一个假名教起。' },
  { value: 'kana', title: '会读假名', desc: '平假名、片假名能认出来，但还不会说句子。' },
  { value: 'N5', title: '大约 N5', desc: '会简单的自我介绍、です・ます，学过一些基础语法。' },
  { value: 'N4', title: '大约 N4', desc: '学完了初级，日常对话能应付一些。' },
  { value: 'N3', title: '大约 N3', desc: '能看懂简单文章，想继续往上走。' },
  { value: 'N2', title: '大约 N2', desc: '只差 N1 了。' },
];

const GOALS: Array<{ value: StudyGoal; desc: string }> = [
  { value: 'travel', desc: '去日本自由行：问路、点餐、购物、坐车都能自己搞定。学到 N5 左右。' },
  { value: 'conversation', desc: '能和日本人聊日常话题。学到 N4 左右。' },
  { value: 'N5', desc: '最基础的考试级别，约 800 个词。' },
  { value: 'N4', desc: '能理解基础日语，约 1500 个词。' },
  { value: 'N3', desc: '日常场景基本无障碍，约 3700 个词。' },
  { value: 'N2', desc: '大多数日企招聘的门槛，约 6000 个词。' },
  { value: 'N1', desc: '最高级别，能读报纸、看懂大部分内容。' },
];

const MINUTE_CHIPS = [20, 30, 45, 60, 90, 120];

export function OnboardingPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const settings = useSettingsData();
  const today = todayIn(settings?.timezone);
  const existing = useQuery({ queryKey: ['plan'], queryFn: learnApi.plan, retry: false });
  const [step, setStep] = useState(0);
  const [f, setF] = useState<StudyPlanInput>({ startLevel: 'zero', goal: 'N4', targetDate: addDays(today, 730), dailyMinutes: 45, reminderTime: '20:00', lateReminder: true });
  const [preview, setPreview] = useState<PlanPreview | null>(null);

  useEffect(() => {
    const p = existing.data;
    if (p) setF({ startLevel: p.startLevel, goal: p.goal, targetDate: p.targetDate, dailyMinutes: p.dailyMinutes, reminderTime: p.reminderTime, lateReminder: p.lateReminder });
  }, [existing.data]);

  const estimate = useMutation({ mutationFn: (v: StudyPlanInput) => learnApi.preview(v), onSuccess: setPreview });
  const save = useMutation({
    mutationFn: () => learnApi.savePlan({ ...f, baseVersion: existing.data?.version }),
    onSuccess: async () => {
      try {
        localStorage.setItem(ONBOARDED_KEY, '1');
      } catch {
        /* ignore */
      }
      await qc.invalidateQueries({ queryKey: ['plan-today'] });
      void qc.invalidateQueries({ queryKey: ['curriculum'] });
      void learnApi.today().then(rescheduleReminders).catch(() => undefined);
      nav('/', { viewTransition: true, replace: true });
    },
  });

  const steps = ['水平', '目标', '期限', '时长', '提醒', '确认'];
  const go = (n: number) => {
    setStep(n);
    if (n === 5) estimate.mutate(f);
  };
  const levelGoalOk = !(['N5', 'N4', 'N3', 'N2'].indexOf(f.startLevel) >= ['N5', 'N4', 'N3', 'N2', 'N1'].indexOf(f.goal) && ['N5', 'N4', 'N3', 'N2', 'N1'].includes(f.goal));

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-3">
        <TrainSimple weight="fill" className="size-6 text-ok" />
        <div className="flex-1">
          <div className="text-xs font-semibold text-ink-3">制定学习计划 · 第 {step + 1} 步 / 共 {steps.length} 步</div>
          <Rail value={(step + 1) / steps.length} className="mt-1.5" label="向导进度" />
        </div>
      </div>

      <div key={step} className="animate-[rise-in_360ms_var(--ease-out-expo)]">
        {step === 0 && (
          <Step title="你现在的日语水平是？" hint="选最接近的就好。选高了也没关系，后面每一课都可以回头学。">
            <Options items={LEVELS.map((l) => ({ value: l.value, title: l.title, desc: l.desc }))} value={f.startLevel} onChange={(startLevel) => setF({ ...f, startLevel })} />
          </Step>
        )}
        {step === 1 && (
          <Step title="学日语，你想达到什么程度？" hint="目标决定了你的线路有多长。以后随时可以改。">
            <Options items={GOALS.map((g) => ({ value: g.value, title: STUDY_GOAL_LABELS[g.value], desc: g.desc }))} value={f.goal} onChange={(goal) => setF({ ...f, goal })} />
            {!levelGoalOk && <Notice tone="warn" className="mt-3">目标不能低于你现在的水平，请选一个更高的目标。</Notice>}
          </Step>
        )}
        {step === 2 && (
          <Step title="希望在哪天之前达到？" hint="给自己一个期限。下一步会算出每天需要学多久。">
            <div className="flex flex-wrap gap-2">
              {[['3 个月', 90], ['半年', 182], ['1 年', 365], ['1 年半', 547], ['2 年', 730], ['3 年', 1095], ['5 年', 1825]].map(([label, days]) => (
                <Chip key={label} on={f.targetDate === addDays(today, days as number)} onClick={() => setF({ ...f, targetDate: addDays(today, days as number) })}>{label}</Chip>
              ))}
            </div>
            <Input type="date" min={addDays(today, 7)} value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} className="mt-3 max-w-56" aria-label="截止日期" />
          </Step>
        )}
        {step === 3 && (
          <Step title="每天能学多久？" hint="包括看视频、做练习、复习卡片。少而每天坚持，比多而三天打鱼有效得多。">
            <div className="flex flex-wrap gap-2">
              {MINUTE_CHIPS.map((m) => <Chip key={m} on={f.dailyMinutes === m} onClick={() => setF({ ...f, dailyMinutes: m })}>{m} 分钟</Chip>)}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <input type="range" min={10} max={180} step={5} value={f.dailyMinutes} onChange={(e) => setF({ ...f, dailyMinutes: Number(e.target.value) })} className="flex-1 accent-[var(--go)]" aria-label="每天分钟数" />
              <span className="font-sign w-20 text-right text-2xl font-bold tabular">{f.dailyMinutes}′</span>
            </div>
          </Step>
        )}
        {step === 4 && (
          <Step title="每天几点提醒你学习？" hint={remindersSupported ? '到点会弹一条通知。学过了当天就不再打扰。' : '网页版没法定时提醒；装上安卓或 Windows 版就会按时提醒你。'}>
            <div className="flex items-center gap-3">
              <Bell weight="duotone" className="size-6 text-ok" />
              <Input type="time" value={f.reminderTime ?? ''} disabled={f.reminderTime === null} onChange={(e) => setF({ ...f, reminderTime: e.target.value || null })} className="max-w-40" aria-label="提醒时间" />
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <Switch checked={f.reminderTime !== null} onChange={(on) => setF({ ...f, reminderTime: on ? '20:00' : null })} label="开启提醒" />
                提醒
              </label>
            </div>
            {f.reminderTime && (
              <label className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
                <span>到晚上 9 点还没开始学，再提醒一次</span>
                <Switch checked={f.lateReminder} onChange={(lateReminder) => setF({ ...f, lateReminder })} label="晚间补催" />
              </label>
            )}
            {platform === 'desktop' && <p className="mt-3 text-xs text-ink-3">Windows 版要在程序开着（可以最小化）时才能弹出提醒。</p>}
          </Step>
        )}
        {step === 5 && (
          <Step title="这条线路长这样" hint="确认后就出发。之后每天打开「今日」，跟着走就行。">
            {estimate.isPending || !preview ? (
              <div className="py-10 text-center text-sm text-ink-3">正在计算……</div>
            ) : (
              <PreviewCard p={preview} f={f} onFix={(patch) => { const next = { ...f, ...patch }; setF(next); estimate.mutate(next); }} />
            )}
            {estimate.isError && <Notice tone="error">{errorText(estimate.error)}</Notice>}
          </Step>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => (step ? go(step - 1) : nav(-1))}>{step ? '上一步' : '返回'}</Button>
        {step < 5 ? (
          <Button size="lg" onClick={() => go(step + 1)} disabled={step === 1 && !levelGoalOk}>
            下一步 <ArrowRight weight="bold" className="size-4" />
          </Button>
        ) : (
          <Button size="lg" icon={TrainSimple} onClick={() => save.mutate()} loading={save.isPending} disabled={!preview}>出发</Button>
        )}
      </div>
      {save.isError && <Notice tone="error" className="mt-3">{save.error instanceof ApiError && save.error.code === 'QUEUED' ? '需要联网才能保存计划' : errorText(save.error)}</Notice>}
    </div>
  );
}

function Step({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <h1 className="text-[26px] font-black leading-tight">{title}</h1>
      <p className="mb-5 mt-2 text-ink-3">{hint}</p>
      {children}
    </section>
  );
}

function Options<T extends string>({ items, value, onChange }: { items: Array<{ value: T; title: string; desc: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="grid gap-2">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.value)}
            className={cx('flex items-start gap-3 rounded-2xl px-4 py-3.5 text-left ring-1 ring-inset transition', on ? 'bg-go-soft ring-ok/50' : 'bg-surface ring-line hover:ring-rail')}
          >
            <span className={cx('mt-1 grid size-5 shrink-0 place-items-center rounded-full ring-2 ring-inset', on ? 'bg-ok ring-ok' : 'ring-rail')}>
              {on && <span className="size-2 rounded-full bg-white" />}
            </span>
            <span>
              <span className="block font-bold">{it.title}</span>
              <span className="block text-sm text-ink-3">{it.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('min-h-10 rounded-full px-4 text-sm font-semibold transition', on ? 'bg-ink text-ground' : 'bg-surface ring-1 ring-line hover:ring-rail')}>
      {children}
    </button>
  );
}

function PreviewCard({ p, f, onFix }: { p: PlanPreview; f: StudyPlanInput; onFix: (patch: Partial<StudyPlanInput>) => void }) {
  const fmt = (d: string) => `${Number(d.slice(0, 4))} 年 ${Number(d.slice(5, 7))} 月 ${Number(d.slice(8))} 日`;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-4 text-center lift">
        <div><dd className="font-sign text-3xl font-bold tabular">{p.lessonCount}</dd><dt className="text-xs font-semibold text-ink-3">站（课）</dt></div>
        <div><dd className="font-sign text-3xl font-bold tabular">{Math.round(p.estimatedHours)}</dd><dt className="text-xs font-semibold text-ink-3">小时</dt></div>
        <div><dd className="font-sign text-3xl font-bold tabular">{(() => { const d = ((p.estimatedHours * 60) / Math.max(p.lessonCount, 1)) / f.dailyMinutes; return d >= 1 ? `${Math.round(d)}天/站` : `${Math.round(1 / d)}站/天`; })()}</dd><dt className="text-xs font-semibold text-ink-3">节奏</dt></div>
      </dl>
      <p className="px-1 text-xs leading-relaxed text-ink-3">小时数是总学习量：上课、背词、复习、听读和备考都算在内，按零基础的中文母语者估算（到 N2 约 1000 小时）。过一站很快，但要真正掌握，大部分时间花在反复使用上。实际快慢因人而异。</p>
      {p.feasible ? (
        <Notice tone="ok">
          <CheckCircle weight="fill" className="mr-1 inline size-4" />
          来得及。按每天 {f.dailyMinutes} 分钟，预计 <b>{fmt(p.projectedFinish)}</b> 到站，比期限早。
        </Notice>
      ) : (
        <div className="space-y-2">
          <Notice tone="warn">
            <Warning weight="fill" className="mr-1 inline size-4" />
            按每天 {f.dailyMinutes} 分钟，要到 <b>{fmt(p.projectedFinish)}</b> 才能到站，赶不上期限。两种调整方式：
          </Notice>
          <div className="grid gap-2 sm:grid-cols-2">
            {p.minutesNeeded <= 600 && <Button variant="outline" onClick={() => onFix({ dailyMinutes: Math.ceil(p.minutesNeeded / 5) * 5 })}>每天学 {Math.ceil(p.minutesNeeded / 5) * 5} 分钟</Button>}
            <Button variant="outline" onClick={() => onFix({ targetDate: p.projectedFinish })}>期限改到 {p.projectedFinish}</Button>
          </div>
        </div>
      )}
      <p className="text-sm text-ink-3">线路：{f.startLevel === 'zero' ? '入门 → 假名 → ' : ''}按《新标准日本语》课序，每课先看视频，再读讲解、做练习，过关才到站。</p>
    </div>
  );
}
