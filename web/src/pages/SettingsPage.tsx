/**
 * 设置页：读 → 编辑草稿 → 带 baseVersion 保存。
 * 若别的设备抢先改过（409），给出两条路：保留本地（以服务端版本为基重新提交）或保留服务端（丢弃草稿）。
 * 这正是阶段 7 冲突 UI 的雏形。
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DAY_MODES, DAY_MODE_DEFAULT_MINUTES, FURIGANA_MODES, JLPT_LEVELS, THEMES, WEEKDAYS, type DayMode } from '@shared/constants';
import type { Settings, SettingsData } from '@shared/types';
import { ApiError, newClientOpId } from '@/api/client';
import { settingsApi } from '@/api/endpoints';
import { Button, Card, Field, Input, Notice, PageHeader, Segmented, Select, Spinner, errorText } from '@/components/ui';
import { AboutCard, DataCard } from './settings/DataCards';
import { AiKeyCard } from './settings/AiKeyCard';
import { Link } from 'react-router-dom';
import { rememberTheme, useTheme } from '@/lib/hooks';
import { offlineSupported } from '@/platform/recognizer';
import { recognizerChoice, setRecognizerChoice, speech, systemSpeech, type RecognizerChoice, type Voice } from '@/platform/speech';
import { useModelGate } from '@/components/practice';
import { useAuth } from '@/stores/auth';
import { remindersSupported, testReminder } from '@/lib/notify';
import { platform } from '@/platform';

const WEEKDAY_LABEL: Record<(typeof WEEKDAYS)[number], string> = { mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六', sun: '日' };
const DAY_MODE_LABEL: Record<DayMode, string> = { minimal: '最小日', standard: '标准日', sprint: '冲刺日' };
const FURIGANA_LABEL = { always: '始终显示', unknownOnly: '仅生词', never: '不显示' } as const;
const THEME_LABEL = { system: '跟随系统', light: '浅色', dark: '深色' } as const;
const TIMEZONES = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'America/Los_Angeles', 'America/New_York'];

interface Conflict {
  server: Settings;
  draft: SettingsData;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const logout = useAuth((s) => s.logout);
  const query = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.data);
  }, [query.data, draft]);

  useTheme(draft?.theme ?? 'system');

  const dirty = useMemo(() => !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(query.data.data), [draft, query.data]);

  const save = useMutation({
    mutationFn: ({ data, baseVersion }: { data: SettingsData; baseVersion: number }) =>
      settingsApi.put({ clientOpId: newClientOpId(), baseVersion, data }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      setDraft(s.data);
      setConflict(null);
      rememberTheme(s.data.theme);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e, vars) => {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        const server = (e.details as { serverRecord: Settings }).serverRecord;
        setConflict({ server, draft: vars.data });
      }
    },
  });

  if (query.isPending || !draft) {
    return query.isError ? <Notice tone="error">{errorText(query.error)}</Notice> : <Spinner className="text-ink-3" />;
  }

  const set = <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => setDraft({ ...draft, [k]: v });
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);
  const tzOptions = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES];

  return (
    <div className="space-y-4">
      <PageHeader title="设置" subtitle="改完点底部的保存；换设备登录后设置会跟过去" />

      {conflict && (
        <Notice tone="warn">
          <p className="mb-2 font-medium">设置已在其他设备上被修改（服务端版本 v{conflict.server.version}）</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate({ data: conflict.draft, baseVersion: conflict.server.version })} loading={save.isPending}>
              保留本地
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                qc.setQueryData(['settings'], conflict.server);
                setDraft(conflict.server.data);
                setConflict(null);
              }}
            >
              保留服务端
            </Button>
          </div>
        </Notice>
      )}
      {save.isError && !conflict && <Notice tone="error">{errorText(save.error)}</Notice>}

      <Card title="周计划">
        <p className="mb-3 text-xs text-ink-3">
          {DAY_MODES.map((m) => `${DAY_MODE_LABEL[m]}约 ${DAY_MODE_DEFAULT_MINUTES[m]} 分钟`).join(' · ')}
        </p>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d) => (
            <label key={d} className="text-center">
              <span className="mb-1 block text-xs text-ink-3">周{WEEKDAY_LABEL[d]}</span>
              <select
                aria-label={`周${WEEKDAY_LABEL[d]}`}
                value={draft.weekPlan[d]}
                onChange={(e) => set('weekPlan', { ...draft.weekPlan, [d]: e.target.value as DayMode })}
                className="min-h-11 w-full appearance-none rounded-lg bg-surface px-0 text-center text-xs ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-go"
              >
                {DAY_MODES.map((m) => (
                  <option key={m} value={m}>{DAY_MODE_LABEL[m].slice(0, 2)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="每日目标（分钟）">
            <Input type="number" inputMode="numeric" min={5} max={600} value={draft.dailyGoalMinutes} onChange={(e) => set('dailyGoalMinutes', num(e.target.value, draft.dailyGoalMinutes))} />
          </Field>
          <Field label="目标等级">
            <Select value={draft.jlptTarget} onChange={(e) => set('jlptTarget', e.target.value as SettingsData['jlptTarget'])}>
              {JLPT_LEVELS.map((l) => <option key={l}>{l}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="抽认卡">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="每日新卡">
            <Input type="number" inputMode="numeric" min={0} max={500} value={draft.newCardsPerDay} onChange={(e) => set('newCardsPerDay', num(e.target.value, draft.newCardsPerDay))} />
          </Field>
          <Field label="每日复习上限">
            <Input type="number" inputMode="numeric" min={0} max={5000} value={draft.reviewLimitPerDay} onChange={(e) => set('reviewLimitPerDay', num(e.target.value, draft.reviewLimitPerDay))} />
          </Field>
          <Field label="默认牌组">
            <Input value={draft.defaultDeck} maxLength={60} onChange={(e) => set('defaultDeck', e.target.value)} />
          </Field>
          <Field label={`目标记忆保持率 ${Math.round(draft.desiredRetention * 100)}%`} hint="越高复习越频繁">
            <input type="range" min={0.7} max={0.97} step={0.01} value={draft.desiredRetention} onChange={(e) => set('desiredRetention', Number(e.target.value))} className="w-full accent-[var(--go)]" />
          </Field>
        </div>
      </Card>

      <VoiceCard draft={draft} set={set} />

      <Card title="显示">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="主题">
            <Select value={draft.theme} onChange={(e) => set('theme', e.target.value as SettingsData['theme'])}>
              {THEMES.map((t) => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="假名注音">
            <Select value={draft.furiganaMode} onChange={(e) => set('furiganaMode', e.target.value as SettingsData['furiganaMode'])}>
              {FURIGANA_MODES.map((f) => <option key={f} value={f}>{FURIGANA_LABEL[f]}</option>)}
            </Select>
          </Field>
          <Field label="时区" hint="决定「今天」从几点开始">
            <Select value={draft.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {tzOptions.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-[calc(5rem+var(--sab))] z-10 flex items-center justify-end gap-3 rounded-2xl bg-surface/95 p-3 backdrop-blur lift ring-1 ring-line md:bottom-4">
        {saved && <span className="text-sm text-ok">已保存</span>}
        <span className="mr-auto text-xs text-ink-3">v{query.data?.version}</span>
        <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(query.data!.data)}>还原</Button>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ data: draft, baseVersion: query.data!.version })}>
          保存
        </Button>
      </div>

      <AiKeyCard />

      <Card title="学习计划">
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-[1_1_14rem] text-sm text-ink-2">目标、期限、每天时长和提醒时间都在这里改。没学够每天的时长，到提醒时间会发通知。</p>
          <Link to="/onboarding" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1 ring-inset ring-line hover:ring-rail">重新规划</Link>
        </div>
      </Card>

      {remindersSupported && <ReminderTest />}
      <DataCard />
      <AboutCard />

      <Card title="账号">
        <Button variant="danger" onClick={() => void logout()}>退出登录</Button>
      </Card>
    </div>
  );
}

/** 语音识别：默认用内置离线识别（Vosk），可改回系统识别；模型可在这里提前下载 */
function RecognizerField() {
  const [choice, setChoice] = useState<RecognizerChoice>(recognizerChoice());
  const [sysOk, setSysOk] = useState<boolean | null>(null);
  const gate = useModelGate();
  useEffect(() => {
    void systemSpeech.recognitionAvailable().then(setSysOk);
  }, []);
  const pick = (c: RecognizerChoice) => {
    setRecognizerChoice(c);
    setChoice(c);
  };
  return (
    <div className="space-y-3">
      <Field label="语音识别（跟读、发音练习用）">
        <Segmented
          label="语音识别"
          value={choice}
          onChange={pick}
          options={[
            ...(offlineSupported() ? [{ value: 'offline' as const, label: '内置离线识别' }] : []),
            { value: 'system' as const, label: '系统识别' },
          ]}
        />
      </Field>
      {choice === 'offline' ? (
        <>
          <p className="text-sm text-ink-2">识别在本机完成，电脑和手机都能用，断网也行。模型较小，识别不算准，所以评分会放宽。</p>
          {gate ?? <p className="text-sm text-ok">识别模型已下载。</p>}
        </>
      ) : (
        sysOk === false && <Notice tone="info">这台设备没有可用的系统语音识别，建议改用内置离线识别。</Notice>
      )}
    </div>
  );
}

/** 语音：朗读默认用在线音频（各平台同一个声音）；下面选的系统声音只在拿不到在线音频时兜底 */
function VoiceCard({ draft, set }: { draft: SettingsData; set: <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => void }) {
  const [state, setState] = useState<{ tts: boolean; recognition: boolean; voices: Voice[] } | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([speech.ttsAvailable(), speech.recognitionAvailable(), systemSpeech.voices()]).then(([tts, recognition, voices]) => {
      if (alive) setState({ tts, recognition, voices });
    });
    return () => {
      alive = false;
      void speech.stop();
    };
  }, []);

  async function preview() {
    setSpeaking(true);
    try {
      await speech.speak('こんにちは。今日も一緒に日本語を勉強しましょう。', { rate: draft.speechRate, voiceName: draft.ttsVoice });
    } finally {
      setSpeaking(false);
    }
  }

  if (!state) return <Card title="语音"><Spinner className="text-ink-3" /></Card>;

  return (
    <Card title="语音">
      <div className="space-y-4">
        <RecognizerField />
        {!state.tts ? (
          <Notice tone="warn">当前设备不支持日语朗读，听力与跟读将改为文字对照。</Notice>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-ink-2 sm:col-span-2">朗读用的是在线生成的日语语音，听过的句子会存在本机，断网也能放。只有在线语音拿不到时，才会用下面的系统声音。</p>
            <Field label="备用的系统声音" hint={state.voices.length ? undefined : '这台设备没有日语语音包；断网时没听过的句子可能读不出来'}>
              <Select value={draft.ttsVoice ?? ''} onChange={(e) => set('ttsVoice', e.target.value || null)}>
                <option value="">自动</option>
                {state.voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </Select>
            </Field>
            <Field label={`语速 ${draft.speechRate.toFixed(2)}×`}>
              <input type="range" min={0.5} max={1.5} step={0.05} value={draft.speechRate} onChange={(e) => set('speechRate', Number(e.target.value))} className="w-full accent-[var(--go)]" />
            </Field>
            <div className="sm:col-span-2">
              <Button variant="secondary" onClick={() => void preview()} loading={speaking}>试听</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ReminderTest() {
  const t = useMutation({ mutationFn: testReminder });
  return (
    <Card title="学习提醒">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => t.mutate()} loading={t.isPending}>试一下提醒</Button>
        {t.data && <p className="min-w-0 flex-[1_1_14rem] text-sm text-ink-2">{t.data}</p>}
      </div>
      {platform === 'android' && (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">App 不在前台就收不到、或者只进通知栏不弹横幅？</p>
          <p className="mt-1">国产手机默认会拦住后台应用的定时提醒，要在手机设置里给一駅打开这几项（名字各品牌略有不同）：</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>应用设置 → 通知：允许通知，打开「横幅 / 悬浮通知」和「锁屏通知」</li>
            <li>通知里的「学习提醒」类别：重要程度选最高</li>
            <li>自启动（或"应用启动管理"）：允许</li>
            <li>省电策略 / 电池优化：选「无限制」或"不优化"</li>
          </ul>
        </div>
      )}
    </Card>
  );
}
