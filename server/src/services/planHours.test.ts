import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUMULATIVE_HOURS, CURRICULUM, planMinutes } from '../content/curriculum';
import { preview } from './learning';

const input = (goal: 'N5' | 'N4' | 'N3' | 'N2' | 'N1', dailyMinutes = 60, targetDate = '2030-01-01') =>
  ({ startLevel: 'zero', goal, targetDate, dailyMinutes, reminderTime: '20:00', lateReminder: false }) as Parameters<typeof preview>[0];

test('学时：零基础到各级的累计小时数与校准表一致', () => {
  for (const goal of ['N5', 'N4', 'N3', 'N2', 'N1'] as const) {
    assert.equal(Math.round(preview(input(goal), '2026-01-01').estimatedHours), CUMULATIVE_HOURS[goal], goal);
  }
});

test('学时：到 N2 约 1000 小时，每天一小时要两年半以上', () => {
  const p = preview(input('N2'), '2026-01-01');
  assert.ok(p.estimatedHours >= 950 && p.estimatedHours <= 1100);
  assert.equal(p.projectedFinish > '2028-07-01', true);
});

test('学时：每一课都分到了学习量，高级别每站更重', () => {
  for (const l of CURRICULUM) assert.ok(planMinutes(l) > 0, l.id);
  const avg = (part: string) => {
    const ls = CURRICULUM.filter((l) => l.part === part);
    return ls.reduce((s, l) => s + planMinutes(l), 0) / ls.length;
  };
  assert.ok(avg('N1') > avg('N5'));
});
