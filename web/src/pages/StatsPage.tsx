/**
 * 统计：连续天数、区间合计、每日时长、各模块时长、错题与测验、四条趋势、场景掌握。
 * 每个指标一张图、一个量纲；各模块用线路徽章标明身份，柱子统一用图表色。
 */
import { ChartLineUp, Fire } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SCENARIO_CATEGORY_LABELS } from '@shared/constants';
import type { StatsResponse, TrendPoint } from '@shared/types';
import { statsApi } from '@/api/endpoints';
import { BarChart, HBar, LineChart } from '@/components/charts';
import { Card, EmptyState, LineBadge, Notice, PageHeader, Segmented, Skeleton, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { addDays, todayIn, useSettingsData } from '@/lib/study';

const RANGES = { '7': 7, '30': 30, '90': 90 } as const;
type RangeKey = keyof typeof RANGES;

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`;
const toPoints = (t: TrendPoint[]) => t.map((p) => ({ label: md(p.date), value: p.value }));

export function StatsPage() {
  const settings = useSettingsData();
  const [range, setRange] = useState<RangeKey>('30');
  const to = todayIn(settings?.timezone);
  const from = addDays(to, -(RANGES[range] - 1));
  const q = useQuery({ queryKey: ['stats', from, to], queryFn: () => statsApi.get(from, to), enabled: !!settings });

  return (
    <div>
      <PageHeader title="统计" subtitle={`${from} — ${to}`} actions={<Segmented label="时间范围" value={range} onChange={setRange} options={[{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }]} />} />
      {q.isError ? <Notice tone="error">{errorText(q.error)}</Notice> : !q.data ? <Loading /> : <Body s={q.data} />}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Skeleton className="h-28 sm:col-span-2" />
      <Skeleton className="h-52 sm:col-span-2" />
      <Skeleton className="h-44" />
      <Skeleton className="h-44" />
    </div>
  );
}

function Body({ s }: { s: StatsResponse }) {
  const totals: Array<[string, string]> = [
    ['学习时长', `${s.totals.minutes} 分`],
    ['复习卡片', String(s.totals.cardsReviewed)],
    ['新学卡片', String(s.totals.cardsLearned)],
    ['完成任务', String(s.totals.tasksDone)],
    ['场景对话', String(s.totals.conversations)],
    ['写作', `${s.totals.writingEntries} 篇`],
  ];
  const maxModule = Math.max(...s.moduleMinutes.map((m) => m.minutes), 0);
  const nothing = s.totals.minutes === 0 && s.totals.cardsReviewed === 0 && s.totals.tasksDone === 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="sm:col-span-2">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-go-soft text-ok"><Fire weight="fill" className="size-6" /></span>
            <div>
              <div className="font-sign text-3xl font-bold leading-none tabular">{s.streak.current}<span className="ml-1 text-base text-ink-3">天</span></div>
              <div className="mt-1 text-xs font-semibold text-ink-3">{s.streak.studiedToday ? '今天已学习' : '今天还没学'} · 最长 {s.streak.longest} 天</div>
            </div>
          </div>
          <dl className="grid min-w-0 flex-[1_1_18rem] grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6 sm:gap-x-6">
            {totals.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-semibold text-ink-3">{k}</dt>
                <dd className="font-sign text-lg font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      {nothing && (
        <Card className="sm:col-span-2"><EmptyState icon={ChartLineUp} title="这段时间还没有学习记录">在各练习页停留超过 20 秒就会记录时长；复习、任务、测验也都会算进来。</EmptyState></Card>
      )}

      <Card title="每日学习时长（分钟）" className="sm:col-span-2">
        <BarChart data={s.daily.map((d) => ({ label: md(d.date), value: d.minutes }))} unit=" 分" ariaLabel="每日学习时长柱状图" />
      </Card>

      <Card title="各模块时长">
        {s.moduleMinutes.length ? (
          <ul className="space-y-2.5">
            {s.moduleMinutes.map((m) => {
              const line = lineOf(m.module);
              return (
                <li key={m.module} className="flex items-center gap-2.5 text-sm">
                  <LineBadge line={line} size="sm" />
                  <span className="w-16 shrink-0 truncate font-semibold">{line.name}</span>
                  <HBar value={m.minutes} max={maxModule} />
                  <span className="font-sign w-12 text-right tabular">{m.minutes}′</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-ink-3">还没有记录到练习时长</p>
        )}
      </Card>

      <Card title="错题与测验">
        <dl className="grid grid-cols-3 gap-3 text-center">
          {([['待攻克', s.mistakes.open], ['已掌握', s.mistakes.mastered], ['测验题', s.mistakes.quizAnswered]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2 py-3">
              <dd className="font-sign text-2xl font-bold tabular">{v}</dd>
              <dt className="text-xs font-semibold text-ink-3">{k}</dt>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-center gap-3 text-sm">
          <span className="font-semibold text-ink-3">测验错误率</span>
          <HBar value={s.mistakes.errorRate} max={1} />
          <span className="font-sign w-12 text-right font-semibold tabular">{Math.round(s.mistakes.errorRate * 100)}%</span>
        </div>
      </Card>

      <Card title="开口练习分数"><LineChart data={toPoints(s.trends.speakingOverall)} unit=" 分" yMax={100} ariaLabel="朗读跟读综合分趋势" /></Card>
      <Card title="写作分数"><LineChart data={toPoints(s.trends.writingScore)} unit=" 分" yMax={100} ariaLabel="写作批改分数趋势" /></Card>
      <Card title="估算词汇量"><LineChart data={toPoints(s.trends.vocabEstimate)} unit=" 词" ariaLabel="词汇量估算趋势" /></Card>
      <Card title="JLPT 模考得分率"><LineChart data={s.trends.jlptMock.map((p) => ({ label: `${md(p.date)} ${p.level}`, value: p.value }))} unit="%" yMax={100} ariaLabel="JLPT 模考得分率趋势" /></Card>

      <Card title="场景掌握" className="sm:col-span-2">
        <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {s.scenarioMastery.map((m) => (
            <li key={m.category} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 font-semibold">{SCENARIO_CATEGORY_LABELS[m.category]}</span>
              <HBar value={m.mastered} max={m.total} />
              <span className="font-sign w-20 text-right tabular text-ink-2">{m.mastered}/{m.total}{m.avgScore !== null && <span className="text-ink-3"> · {m.avgScore}</span>}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
