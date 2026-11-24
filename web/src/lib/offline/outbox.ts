/**
 * 离线写入（契约 §8.6）：可推送实体的写操作因断网失败时，转成 SyncOp 存进 IndexedDB 的 outbox，
 * 联网后按顺序 /sync/push。结果：applied / duplicate 出队；rejected 出队并记下原因；conflict 留在队里等用户裁决。
 *
 * 同一个 clientOpId 原样带过去：断网前若服务端其实已经处理了，push 会得到 duplicate，不会重复执行。
 */
import { openDB, type IDBPDatabase } from 'idb';
import { create } from 'zustand';
import { SYNC_LIMITS, type PushableEntity } from '@shared/constants';
import type { SyncOp, SyncOpResult } from '@shared/types';

interface QueuedOp extends SyncOp {
  seq: number;
  /** 冲突时服务端的当前记录 */
  conflict?: unknown;
  /** 人看得懂的一句话，给冲突提示用 */
  label: string;
}

type Body = Record<string, unknown>;

/* ───────────── 存储 ───────────── */

let dbp: Promise<IDBPDatabase> | null = null;
export function db() {
  dbp ??= openDB('jp-study', 1, {
    upgrade(d) {
      d.createObjectStore('outbox', { keyPath: 'clientOpId' }).createIndex('seq', 'seq');
      d.createObjectStore('kv');
    },
  });
  return dbp;
}

/* ───────────── 请求 → SyncOp ───────────── */

const CRUD: Record<string, PushableEntity> = {
  tasks: 'task',
  'task-templates': 'taskTemplate',
  cards: 'card',
  mistakes: 'mistake',
  phrases: 'phrase',
  courses: 'course',
};
const CREATE_ONLY: Record<string, PushableEntity> = {
  '/speaking/attempts': 'speakingAttempt',
  '/listening/attempts': 'listeningAttempt',
  '/reading/attempts': 'readingAttempt',
  '/pronunciation/attempts': 'pronunciationAttempt',
  '/expressions/attempts': 'expressionAttempt',
  '/kanji/attempts': 'kanjiAttempt',
  '/stats/time-logs': 'timeLog',
  '/stats/jlpt-mocks': 'jlptMock',
};
const ENTITY_ZH: Partial<Record<PushableEntity, string>> = {
  settings: '设置', task: '任务', taskTemplate: '任务模板', card: '卡片', reviewLog: '复习记录', mistake: '错题', phrase: '句子',
  course: '课程', timeLog: '学习时长', jlptMock: '模考成绩',
};

function strip(body: Body): Body {
  const { clientOpId: _c, baseVersion: _b, ...rest } = body;
  return rest;
}

/** 能转成同步操作的写请求才入队；AI、生成任务、导入导出等在线操作返回 null */
export function opFromRequest(method: string, path: string, body: Body | undefined, query: Body | undefined, userId: string | null): Omit<QueuedOp, 'seq'> | null {
  const now = new Date().toISOString();
  const clientOpId = (body?.clientOpId ?? query?.clientOpId) as string | undefined;
  if (!clientOpId) return null;
  const parts = path.split('/').filter(Boolean);

  if (method === 'PUT' && path === '/settings' && userId && body) {
    return { clientOpId, entity: 'settings', action: 'update', id: userId, baseVersion: body.baseVersion as number, data: body.data as Body, clientTimestamp: now, label: '修改了设置' };
  }
  if (method === 'PUT' && parts.length === 3 && parts[0] === 'video-progress' && body) {
    const { positionSec, completed } = body as { positionSec: number; completed?: boolean };
    return { clientOpId, entity: 'videoProgress', action: 'create', id: crypto.randomUUID(), data: { courseId: parts[1], page: Number(parts[2]), positionSec, ...(completed === undefined ? {} : { completed }) }, clientTimestamp: now, label: '记录了观看进度' };
  }
  if (method === 'POST' && parts.length === 3 && parts[0] === 'cards' && parts[2] === 'review' && body) {
    const { id, ...rest } = strip(body);
    return { clientOpId, entity: 'reviewLog', action: 'create', id: (id as string) ?? clientOpId, data: { cardId: parts[1], ...rest }, clientTimestamp: now, label: '复习了一张卡片' };
  }
  if (method === 'POST' && parts.length === 3 && parts[0] === 'phrases' && parts[2] === 'attempts' && body) {
    const { id, ...rest } = strip(body);
    return { clientOpId, entity: 'phraseAttempt', action: 'create', id: (id as string) ?? crypto.randomUUID(), data: { phraseId: parts[1], attemptedAt: now, ...rest }, clientTimestamp: now, label: '跟读了一句' };
  }
  const createOnly = CREATE_ONLY[path];
  if (method === 'POST' && createOnly && body) {
    const { id, ...rest } = strip(body);
    const timed = createOnly.endsWith('Attempt') ? { attemptedAt: now } : {};
    return { clientOpId, entity: createOnly, action: 'create', id: (id as string) ?? crypto.randomUUID(), data: { ...timed, ...rest }, clientTimestamp: now, label: `记录了${ENTITY_ZH[createOnly] ?? '一次练习'}` };
  }
  const entity = CRUD[parts[0]];
  if (!entity) return null;
  const zh = ENTITY_ZH[entity] ?? entity;
  if (method === 'POST' && parts.length === 1 && body) {
    const { id, ...rest } = strip(body);
    return { clientOpId, entity, action: 'create', id: (id as string) ?? crypto.randomUUID(), data: rest, clientTimestamp: now, label: `新建了${zh}` };
  }
  if (method === 'PATCH' && parts.length === 2 && body && typeof body.baseVersion === 'number') {
    return { clientOpId, entity, action: 'update', id: parts[1], baseVersion: body.baseVersion, data: strip(body), clientTimestamp: now, label: `修改了${zh}` };
  }
  if (method === 'DELETE' && parts.length === 2 && query?.baseVersion) {
    return { clientOpId, entity, action: 'delete', id: parts[1], baseVersion: Number(query.baseVersion), clientTimestamp: now, label: `删除了${zh}` };
  }
  return null;
}

/* ───────────── 队列状态（给界面看） ───────────── */

interface OutboxState {
  pending: number;
  conflicts: QueuedOp[];
  rejected: Array<{ label: string; message: string }>;
  syncing: boolean;
}
export const useOutbox = create<OutboxState>(() => ({ pending: 0, conflicts: [], rejected: [], syncing: false }));

async function refreshState() {
  const all = (await (await db()).getAllFromIndex('outbox', 'seq')) as QueuedOp[];
  useOutbox.setState({ pending: all.length, conflicts: all.filter((o) => o.conflict !== undefined) });
}

export async function enqueue(op: Omit<QueuedOp, 'seq'>): Promise<void> {
  const d = await db();
  await d.put('outbox', { ...op, seq: Date.now() + Math.random() });
  await refreshState();
}

/* ───────────── 推送 ───────────── */

type Push = (ops: SyncOp[]) => Promise<SyncOpResult[]>;
let push: Push | null = null;
let onSynced: (() => void) | null = null;

/** 由 main.tsx 注入推送函数与"同步后刷新数据"的回调，避免与 API 客户端循环依赖 */
export function configureOutbox(p: Push, synced: () => void) {
  push = p;
  onSynced = synced;
  void refreshState();
}

let flushing: Promise<void> | null = null;

/** 推送队列中所有未冲突的操作；同一时刻只跑一次 */
export function flush(): Promise<void> {
  flushing ??= doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush() {
  if (!push || !navigator.onLine) return;
  const d = await db();
  const ready = ((await d.getAllFromIndex('outbox', 'seq')) as QueuedOp[]).filter((o) => o.conflict === undefined);
  if (!ready.length) return;
  useOutbox.setState({ syncing: true });
  let changed = false;
  try {
    for (let i = 0; i < ready.length; i += SYNC_LIMITS.pushMaxOps) {
      const batch = ready.slice(i, i + SYNC_LIMITS.pushMaxOps);
      const results = await push(batch.map(({ seq: _s, conflict: _c, label: _l, ...op }) => op));
      for (const r of results) {
        const op = batch.find((o) => o.clientOpId === r.clientOpId);
        if (!op) continue;
        if (r.status === 'conflict') {
          await d.put('outbox', { ...op, conflict: r.serverRecord ?? null });
        } else {
          await d.delete('outbox', r.clientOpId);
          changed = true;
          if (r.status === 'rejected') {
            useOutbox.setState((s) => ({ rejected: [...s.rejected, { label: op.label, message: r.error?.message ?? '服务器拒绝了这次修改' }] }));
          }
        }
      }
    }
  } catch {
    // 推送途中又断网：留在队里，下次再推
  } finally {
    useOutbox.setState({ syncing: false });
    await refreshState();
    if (changed) onSynced?.();
  }
}

/** 冲突裁决：保留本地 = 以服务端版本为基、换新 clientOpId 重推；保留服务端 = 丢弃本地修改 */
export async function resolveConflict(clientOpId: string, keep: 'local' | 'server') {
  const d = await db();
  const op = (await d.get('outbox', clientOpId)) as QueuedOp | undefined;
  if (!op) return;
  await d.delete('outbox', clientOpId);
  if (keep === 'local') {
    const serverVersion = (op.conflict as { version?: number } | null)?.version;
    await d.put('outbox', { ...op, clientOpId: crypto.randomUUID(), baseVersion: serverVersion ?? op.baseVersion, conflict: undefined, seq: op.seq });
  }
  await refreshState();
  if (keep === 'local') await flush();
  else onSynced?.();
}

export function dismissRejected() {
  useOutbox.setState({ rejected: [] });
}

/** 注销时清空：队列里的操作属于上一个账号 */
export async function clearOutbox() {
  await (await db()).clear('outbox');
  await refreshState();
}

