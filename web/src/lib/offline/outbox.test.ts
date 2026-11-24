import { describe, expect, it } from 'vitest';
import { opFromRequest } from './outbox';

const U = '00000000-0000-4000-8000-000000000001';

describe('opFromRequest：断网的写请求 → 同步操作', () => {
  it('新建任务：沿用 clientOpId，补上 id', () => {
    const op = opFromRequest('POST', '/tasks', { clientOpId: 'c1', title: 'x', module: 'other', date: '2026-10-29' }, undefined, U)!;
    expect(op).toMatchObject({ clientOpId: 'c1', entity: 'task', action: 'create', data: { title: 'x' } });
    expect(op.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op.data).not.toHaveProperty('clientOpId');
  });

  it('修改带 baseVersion；缺 baseVersion 的修改不入队', () => {
    expect(opFromRequest('PATCH', '/tasks/t1', { clientOpId: 'c2', baseVersion: 3, status: 'done' }, undefined, U)).toMatchObject({
      entity: 'task', action: 'update', id: 't1', baseVersion: 3, data: { status: 'done' },
    });
    expect(opFromRequest('PATCH', '/mistakes/m1', { clientOpId: 'c3', mastered: true }, undefined, U)).toBeNull();
  });

  it('删除从查询串取 clientOpId 与 baseVersion', () => {
    expect(opFromRequest('DELETE', '/cards/k1', undefined, { clientOpId: 'c4', baseVersion: 2 }, U)).toMatchObject({ entity: 'card', action: 'delete', id: 'k1', baseVersion: 2 });
  });

  it('复习与跟读：路径里的父 id 放进 data', () => {
    expect(opFromRequest('POST', '/cards/k1/review', { clientOpId: 'c5', id: 'r1', rating: 3, reviewedAt: 'T', durationMs: 5 }, undefined, U)).toMatchObject({
      entity: 'reviewLog', id: 'r1', data: { cardId: 'k1', rating: 3 },
    });
    expect(opFromRequest('POST', '/phrases/p1/attempts', { clientOpId: 'c6', id: 'a1', transcript: '', method: 'selfAssessed', durationMs: 0, selfScore: 70 }, undefined, U)).toMatchObject({
      entity: 'phraseAttempt', id: 'a1', data: { phraseId: 'p1', selfScore: 70 },
    });
  });

  it('设置：id 固定为用户 id', () => {
    expect(opFromRequest('PUT', '/settings', { clientOpId: 'c7', baseVersion: 4, data: { theme: 'dark' } }, undefined, U)).toMatchObject({
      entity: 'settings', action: 'update', id: U, baseVersion: 4, data: { theme: 'dark' },
    });
  });

  it('在线操作（AI、生成任务、导入）不入队', () => {
    expect(opFromRequest('POST', '/ai/quiz/check', { clientOpId: 'c8' }, undefined, U)).toBeNull();
    expect(opFromRequest('POST', '/tasks/generate', { clientOpId: 'c9' }, undefined, U)).toBeNull();
    expect(opFromRequest('POST', '/data/import', { clientOpId: 'c10' }, undefined, U)).toBeNull();
  });
});
