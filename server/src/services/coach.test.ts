import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routable } from './coach';

const review = { text: '复习', action: 'review' as const, lessonId: null };

test('建议能点进去：还有到期卡就去复习', () => {
  assert.equal(routable(review, { due: 3, newLeft: 0, hardTotal: 5 }).restudy, undefined);
});

test('建议能点进去：还有今天额度内的新卡就去复习', () => {
  assert.equal(routable(review, { due: 0, newLeft: 5, hardTotal: 5 }).restudy, undefined);
});

test('建议能点进去：复习页空了、有没记牢的卡 → 去重学', () => {
  assert.equal(routable(review, { due: 0, newLeft: 0, hardTotal: 11 }).restudy, 'hard');
});

test('建议能点进去：复习页空了、也没有没记牢的卡 → 这件事做完了', () => {
  // 真实情况：未学新卡还有 77 张，但今天 20 张的额度用完了，选过重来的 11 张也都重学记住了
  const r = routable(review, { due: 0, newLeft: 0, hardTotal: 0 });
  assert.equal(r.status, 'done');
  assert.equal(r.restudy, 'any');
});

test('建议能点进去：其他动作不动', () => {
  const s = { text: '听力', action: 'listening' as const, lessonId: null };
  assert.equal(routable(s, { due: 0, newLeft: 0, hardTotal: 0 }), s);
});
