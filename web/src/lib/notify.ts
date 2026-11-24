/**
 * 每日学习提醒：按计划里的提醒时间提醒一次；开了晚间补催的，21:00 再催一次。今天学够了计划的分钟数就不打扰。
 *
 *   安卓：系统本地定时通知（断网、应用没开都会准时弹），每次打开应用重排未来 7 天。
 *   Windows：系统通知，但只有程序在运行（含最小化）时才能按时弹出 —— 系统限制。
 *   网页：不提供（浏览器无法可靠地定时提醒）。
 *
 * 文案由克劳迪娅的口吻写成，根据进度（落后 / 连续 / 刚开始）挑选。
 */
import type { PlanToday } from '@shared/types';
import { platform } from '@/platform';

const LATE_HOUR = 21;
const DAYS_AHEAD = 7;
const TITLE = '一駅';

export type NotifyMood = 'start' | 'normal' | 'behind' | 'ahead' | 'late' | 'short';

const LINES: Record<NotifyMood, string[]> = {
  start: [
    '红茶泡好了。今天是第一站，本小姐没有在等您。',
    '出发的日子到了。……别让本小姐在站台上站太久。',
  ],
  normal: [
    '红茶泡好了，温度刚好。今天的路线还没走，本小姐没有在等您。',
    '该上车了。今天的几站不长，一杯茶的工夫就能走完。',
    '今天的站点已经排好了。……您来不来，本小姐倒也无所谓。',
    '复习卡片在排队了。别让它们等太久，那并不优雅。',
  ],
  behind: [
    '您已经落后 {n} 站了。……本小姐不是在担心，只是不喜欢晚点的列车。',
    '落后 {n} 站。今天多走一站，就能追上。本小姐相信您做得到——这只是陈述事实。',
  ],
  ahead: [
    '比计划提前了 {n} 站。勉强及格。……别误会，只是本小姐的要求比较高。',
    '提前 {n} 站。今天也保持这个速度吧，本小姐会看着的。',
  ],
  // 今天学过，但还没到计划的分钟数（排提醒时的进度，之后再学多少不会改这句话）
  short: [
    '今天开了个头，但离计划的 {n} 分钟还差一截。……本小姐只是提醒，不是催。',
    '今天的量还没够 {n} 分钟。再坐一会儿吧，红茶还温着。',
  ],
  late: [
    '已经晚上了，今天的路线还一站没走。……本小姐的茶都凉了。',
    '还剩不到三个小时今天就结束了。哪怕只复习十分钟也好。请不要让本小姐失望。',
    '这么晚还没开始？……算了，现在打开也不迟。本小姐等您。',
  ],
};

export function pickLine(mood: NotifyMood, n = 0, seed = Date.now()): string {
  const list = LINES[mood];
  return list[Math.abs(Math.floor(seed / 86400_000)) % list.length].replace('{n}', String(Math.abs(n)));
}

export function moodOf(t: PlanToday): NotifyMood {
  if (t.passedCount === 0) return 'start';
  if (t.behindBy >= 2) return 'behind';
  if (t.behindBy <= -2) return 'ahead';
  return 'normal';
}

/** 把 "HH:mm" 落到某天的本地时间 */
function at(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

interface Planned {
  id: number;
  at: Date;
  body: string;
}

/** 未来几天要发的提醒（纯函数，便于测试） */
export function planNotifications(t: PlanToday, now = new Date()): Planned[] {
  const plan = t.plan;
  if (!plan?.reminderTime) return [];
  const out: Planned[] = [];
  const mood = moodOf(t);
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    const daily = at(day, plan.reminderTime);
    // 今天学够了计划的分钟数：今天的都免了。旧服务端没有 minutesToday，退回"学过就算"
    const enough = t.minutesToday === undefined ? t.studiedToday : t.minutesToday >= plan.dailyMinutes;
    const skipToday = i === 0 && enough;
    const started = i === 0 && t.studiedToday;
    if (daily > now && !skipToday) {
      const body = started ? pickLine('short', plan.dailyMinutes, daily.getTime()) : pickLine(i === 0 ? mood : 'normal', t.behindBy, daily.getTime());
      out.push({ id: 1000 + i, at: daily, body });
    }
    if (plan.lateReminder) {
      const late = at(day, `${LATE_HOUR}:00`);
      const body = started ? pickLine('short', plan.dailyMinutes, late.getTime()) : pickLine('late', 0, late.getTime());
      if (late > now && late > daily && !skipToday) out.push({ id: 2000 + i, at: late, body });
    }
  }
  return out;
}

/* ───────────── 平台实现 ───────────── */

let desktopTimers: Array<ReturnType<typeof setTimeout>> = [];

/**
 * 插件默认的通知渠道重要程度只是"默认"：只进通知栏，不弹横幅。提醒走自己的高优先级渠道。
 * 渠道一旦建好，重要程度只能由用户在系统设置里改，所以换了一个新 id。
 */
const CHANNEL = 'study-reminder';

type Notifications = typeof import('@capacitor/local-notifications').LocalNotifications;

async function androidReady(LocalNotifications: Notifications): Promise<{ ok: boolean; exact: boolean }> {
  let perm = (await LocalNotifications.checkPermissions()).display;
  if (perm !== 'granted') perm = (await LocalNotifications.requestPermissions()).display;
  if (perm !== 'granted') return { ok: false, exact: false };
  await LocalNotifications.createChannel({ id: CHANNEL, name: '学习提醒', description: '每天按计划时间提醒学习', importance: 5, visibility: 1, vibration: true });
  // 精确闹钟要用户在"闹钟和提醒"里允许。没允许时插件会自己跳去设置页 —— 日常重排时不能这样打扰人，只在点"试一下提醒"时去要
  const exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted';
  return { ok: true, exact };
}

const toNative = (n: Planned, exact: boolean) => ({
  id: n.id,
  title: TITLE,
  body: n.body,
  channelId: CHANNEL,
  isExactNotification: exact,
  schedule: { at: n.at, allowWhileIdle: true },
});

async function scheduleAndroid(list: Planned[]): Promise<boolean> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const { ok, exact } = await androidReady(LocalNotifications);
  if (!ok) return false;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (!list.length) return true;
  await LocalNotifications.schedule({ notifications: list.map((n) => toNative(n, exact)) });
  return true;
}

async function scheduleDesktop(list: Planned[]): Promise<boolean> {
  const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === 'granted';
  if (!granted) return false;
  desktopTimers.forEach(clearTimeout);
  // 只排 24 小时内的：程序关掉就没了，下次打开会重排
  desktopTimers = list
    .filter((n) => n.at.getTime() - Date.now() < 86400_000)
    .map((n) => setTimeout(() => sendNotification({ title: TITLE, body: n.body }), n.at.getTime() - Date.now()));
  return true;
}

/** 设置页的"试一下提醒"：5 秒后发一条，确认权限和通知渠道都正常 */
export async function testReminder(): Promise<string> {
  const at = new Date(Date.now() + 5000);
  const one = [{ id: 9001, at, body: '这是一条测试提醒。能看到就说明提醒没问题。' }];
  try {
    if (platform === 'android') {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      let { ok, exact } = await androidReady(LocalNotifications);
      if (!ok) return '没有通知权限：请到手机的"设置 → 应用 → 一駅 → 通知"里打开。';
      if (!exact) exact = (await LocalNotifications.changeExactNotificationSetting()).exact_alarm === 'granted';
      // 测试提醒放在 30 秒后：够时间切到后台、锁屏，正好验证后台能不能弹
      await LocalNotifications.schedule({ notifications: [toNative({ ...one[0], at: new Date(Date.now() + 30_000) }, exact)] });
      const pending = (await LocalNotifications.getPending()).notifications.filter((n) => n.id >= 1000 && n.id < 3000).length;
      return `30 秒后会弹一条测试提醒，现在就切到后台或锁屏试试。已排好 ${pending} 条每日提醒${exact ? '' : '（没有"闹钟和提醒"权限，可能会晚几分钟）'}。`;
    }
    if (platform === 'desktop') {
      const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
      if (!(await isPermissionGranted()) && (await requestPermission()) !== 'granted') return '没有通知权限：请在 Windows 设置里允许一駅发通知。';
      setTimeout(() => sendNotification({ title: TITLE, body: one[0].body }), 5000);
      return '5 秒后会弹一条测试提醒。电脑版要程序开着（最小化也行）才能按时提醒。';
    }
  } catch (e) {
    return `发不出提醒：${e instanceof Error ? e.message : String(e)}`;
  }
  return '网页版不支持定时提醒。';
}

/** 按今天的进度重排提醒；返回是否拿到了通知权限（网页端恒为 false） */
export async function rescheduleReminders(t: PlanToday): Promise<boolean> {
  const list = planNotifications(t);
  try {
    if (platform === 'android') return await scheduleAndroid(list);
    if (platform === 'desktop') return await scheduleDesktop(list);
  } catch {
    /* 通知不可用不影响学习 */
  }
  return false;
}

export const remindersSupported = platform !== 'web';
