import { describe, expect, it } from 'vitest';
import type { PlanToday } from '@shared/types';
import { planNotifications } from './notify';

const today = (o: Partial<PlanToday>): PlanToday =>
  ({
    plan: { reminderTime: '20:00', lateReminder: true, dailyMinutes: 95 },
    nextLessons: [],
    passedCount: 3,
    totalCount: 87,
    behindBy: 0,
    projectedFinish: null,
    studiedToday: false,
    ...o,
  }) as PlanToday;

// 下午两点：今天 20:00、21:00 都还没到
const now = new Date(2026, 10, 2, 14, 0);
const todays = (t: PlanToday) => planNotifications(t, now).filter((n) => n.at.getDate() === 2);

describe('学习提醒', () => {
  it('还没学：今天照常提醒两次', () => {
    expect(todays(today({}))).toHaveLength(2);
  });
  it('学了 15 分钟、目标 95：今天照常提醒，文案说还没够', () => {
    const list = todays(today({ studiedToday: true, minutesToday: 15 }));
    expect(list).toHaveLength(2);
    expect(list[0].body).toContain('95');
  });
  it('学够了：今天不再提醒，明天照常', () => {
    const t = today({ studiedToday: true, minutesToday: 95 });
    expect(todays(t)).toHaveLength(0);
    expect(planNotifications(t, now).length).toBeGreaterThan(0);
  });
  it('旧服务端没有 minutesToday：学过就不提醒', () => {
    expect(todays(today({ studiedToday: true }))).toHaveLength(0);
  });
});
