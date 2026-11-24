/**
 * 安卓桌面小组件（0.14.0）：网页把今天的数据整理成一份快照交给原生，四个小组件只显示这份快照。
 *
 *   打开 App、回到前台、离开 App 时各同步一次（最多一分钟一次）。
 *   小组件里翻卡攒下的结果，下次打开 App 时补交成一轮重学成绩（只练没记牢的卡，不影响复习进度）。
 *   点小组件打开 App 时，跳到它指定的页面。
 *
 * 旧安装包里没有这个原生插件：调用会失败，这里一律安静地跳过。
 */
import { registerPlugin } from '@capacitor/core';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TTS_VOICE } from '@shared/constants';
import type { Card, CoachNote } from '@shared/types';
import { cardsApi, learnApi, statsApi } from '@/api/endpoints';
import { apiOrigin, platform } from '@/platform';
import { normalizeTtsText, prefetchAudio } from '@/platform/audio';
import { useAuth } from '@/stores/auth';

interface WidgetsPlugin {
  update(o: { data: string }): Promise<void>;
  results(): Promise<{ results: string }>;
  clearResults(o: { count: number }): Promise<void>;
  consumeRoute(): Promise<{ route: string | null }>;
  addListener(event: 'route', cb: (e: { route: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

const Widgets = registerPlugin<WidgetsPlugin>('Widgets');
const enabled = platform === 'android';
const WORDS = 20;

async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 小组件上朗读用的地址：服务端按内容哈希缓存的 mp3（先让它生成好） */
async function audioOf(text: string): Promise<string> {
  return `${apiOrigin}/api/v1/tts/${await sha1(`${TTS_VOICE}|${normalizeTtsText(text)}`)}.mp3`;
}

/** 小组件"随手一词"背什么：先背还没记牢的卡，不够再从到期的卡里补；都没有就随手抽学过的卡 */
async function pickWords(): Promise<{ label: string; cards: Card[] }> {
  const hard = (await cardsApi.restudyItems({ hard: true }).catch(() => ({ items: [] as Card[] }))).items;
  if (hard.length >= 5) return { label: '还没记牢', cards: hard.slice(0, WORDS) };
  const due = (await cardsApi.due().catch(() => ({ items: [] as Card[] }))).items;
  const seen = new Set(hard.map((c) => c.id));
  const cards = [...hard, ...due.filter((c) => !seen.has(c.id))].slice(0, WORDS);
  if (cards.length) return { label: hard.length ? '还没记牢 + 今天复习' : '今天复习', cards };
  // 今天的都背完了，桌面上也别空着：从最近学过的 100 张里随手抽
  const learned = (await cardsApi.list({ state: 'review', limit: 100 }).catch(() => ({ items: [] as Card[] }))).items;
  const shuffled = learned.map((c) => [Math.random(), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  return { label: '温故 · 学过的词', cards: shuffled.slice(0, WORDS) };
}

/** 把小组件里翻卡的结果交上去；交成功才从本机删掉 */
async function submitResults() {
  const raw = (await Widgets.results()).results;
  const results = (JSON.parse(raw || '[]') as Array<{ cardId: string; known: boolean }>).filter((r) => r.cardId);
  if (!results.length) return;
  await cardsApi.restudyRound({ scope: 'hard', partial: true, results });
  await Widgets.clearResults({ count: results.length });
}

let last = 0;
let running = false;

export async function syncWidgets(qc: QueryClient, force = false) {
  if (!enabled || running || !useAuth.getState().accessToken || !navigator.onLine) return;
  if (!force && Date.now() - last < 60_000) return;
  running = true;
  last = Date.now();
  try {
    await submitResults().catch(() => undefined);
    const [today, route, stats, words] = await Promise.all([learnApi.today(), learnApi.route(), statsApi.get().catch(() => null), pickWords()]);
    // 点评用主页已经取到的那份：不为小组件另外触发 AI 重写
    const note = qc.getQueryData<CoachNote>(['coach', 'live']);
    const lesson = route.lessons[0] ?? today.nextLessons[0] ?? null;
    const texts = words.cards.map((c) => c.front);
    void prefetchAudio(texts);
    const snapshot = {
      date: route.date,
      minutesToday: today.minutesToday ?? 0,
      dailyMinutes: today.plan?.dailyMinutes ?? 0,
      streak: stats?.streak.current ?? 0,
      passed: today.passedCount,
      total: today.totalCount,
      lesson: lesson ? { id: lesson.id, order: lesson.order, title: lesson.title } : null,
      steps: route.steps.map((s) => ({ title: s.title, detail: s.detail, done: s.done, link: s.link })),
      // 只取第一句：小组件只有四五行
      coach: note ? (note.summary.split(/(?<=[。！？])/)[0] ?? '').slice(0, 80) : '',
      wordsLabel: words.label,
      words: await Promise.all(
        words.cards.map(async (c) => ({ id: c.id, front: c.front, reading: c.reading ?? '', back: c.back, example: c.example ?? '', audio: await audioOf(c.front) })),
      ),
    };
    await Widgets.update({ data: JSON.stringify(snapshot) });
  } catch {
    /* 旧安装包没有小组件插件，或者离线：不影响使用 */
  } finally {
    running = false;
  }
}

/** 挂在登录后的页面框架上：同步快照，处理"点小组件打开某一页" */
export function useWidgetBridge(qc: QueryClient) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return;
    let removed = false;
    let remove: (() => Promise<void>) | undefined;
    void Widgets.consumeRoute()
      .then(({ route }) => route && navigate(route))
      .catch(() => undefined);
    void Widgets.addListener('route', ({ route }) => navigate(route))
      .then((h) => (removed ? void h.remove() : (remove = h.remove)))
      .catch(() => undefined);
    void syncWidgets(qc, true);
    // 离开 App 时同步最要紧：桌面上马上就能看到刚学的分钟数
    const onVis = () => void syncWidgets(qc, document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      removed = true;
      void remove?.();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [navigate, qc]);
}
