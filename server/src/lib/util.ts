import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './errors';
import { PAGINATION, WEEKDAYS, type Weekday } from '../../../shared/constants';

export const uuid = () => randomUUID();

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 键名排序后的 JSON —— 同一内容永远得到同一串，幂等哈希依赖于此 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

/* ───────────── 游标：base64url(JSON {k, id})，对客户端不透明 ───────────── */

export interface CursorValue {
  k: unknown[];
  id: string;
}

export function encodeCursor(c: CursorValue): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string | undefined): CursorValue | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (c && Array.isArray(c.k) && typeof c.id === 'string') return c;
  } catch {
    /* 落到下方统一报错 */
  }
  throw new AppError('VALIDATION_FAILED', '分页游标无效', [{ path: '/cursor', message: '无法解析' }]);
}

export const clampLimit = (limit: number | undefined, max: number = PAGINATION.maxLimit) =>
  Math.min(Math.max(limit ?? PAGINATION.defaultLimit, 1), max);

/** 取 limit+1 条判断是否还有下一页 */
export function paginate<T>(rows: T[], limit: number, keyOf: (row: T) => CursorValue) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeCursor(keyOf(items[items.length - 1])) : null;
  return { items, nextCursor };
}

/* ───────────── 时区与日期 ───────────── */

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 某一时刻在指定时区下的日历日 YYYY-MM-DD */
export function localDate(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function weekdayOf(isoDate: string): Weekday {
  // getUTCDay: 0=周日；WEEKDAYS 以周一开头
  const d = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[(d + 6) % 7];
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ───────────── 行映射：snake_case → camelCase ───────────── */

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** 通用行转换：去掉内部列（user_id、rev），Date 由 JSON 序列化为 ISO Z */
export function camelRow<T = Record<string, unknown>>(row: Record<string, unknown>, omit: string[] = []): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id' || k === 'rev' || omit.includes(k)) continue;
    out[camel(k)] = v;
  }
  return out as T;
}

/* ───────────── 练习记录的发生时间 ───────────── */

/** 未来时间容忍度：客户端时钟略快可以接受，快太多就是在穿越 */
export const FUTURE_SKEW_MS = 5 * 60_000;

/** 离线练习带着发生时间上报；缺省为现在，不接受"来自未来"的时间 */
export function attemptTime(attemptedAt: string | undefined): Date {
  if (!attemptedAt) return new Date();
  const at = new Date(attemptedAt);
  if (at.getTime() > Date.now() + FUTURE_SKEW_MS) {
    throw new AppError('VALIDATION_FAILED', '练习时间不能晚于当前时间', [{ path: '/attemptedAt', message: '来自未来' }]);
  }
  return at;
}

/** 只比较 major.minor.patch；无法解析的部分按 0 处理 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
