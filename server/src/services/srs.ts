/**
 * FSRS 排期（ts-fsrs）。关闭 fuzz：同样的复习历史永远回放出同样的排期，
 * 离线多端补交复习时才能按 reviewedAt 重演而不起争执。
 */
import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type Grade, State } from 'ts-fsrs';
import type { CardState, ReviewRating } from '../../../shared/constants';
import type { Card, FsrsState, ReviewLog } from '../../../shared/types';
import { camelRow } from '../lib/util';

type Row = Record<string, unknown>;

const STATE_BY_ENUM: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};
const ENUM_BY_STATE: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

export const scheduler = (desiredRetention: number) =>
  fsrs(generatorParameters({ request_retention: desiredRetention, enable_fuzz: false }));

export function emptySrs(now: Date) {
  return toColumns(createEmptyCard(now));
}

/** 库行 → ts-fsrs Card */
export function fromRow(row: Row): FsrsCard {
  return {
    due: row.due as Date,
    stability: row.stability as number,
    difficulty: row.difficulty as number,
    scheduled_days: row.scheduled_days as number,
    learning_steps: row.learning_steps as number,
    reps: row.reps as number,
    lapses: row.lapses as number,
    state: ENUM_BY_STATE[row.state as CardState],
    last_review: (row.last_review_at as Date | null) ?? undefined,
  };
}

/** ts-fsrs Card → 库列 */
export function toColumns(c: FsrsCard) {
  return {
    state: STATE_BY_ENUM[c.state],
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    last_review_at: c.last_review ?? null,
  };
}

export function applyReview(retention: number, card: FsrsCard, at: Date, rating: ReviewRating) {
  const { card: next } = scheduler(retention).next(card, at, rating as Grade);
  return next;
}

/** 从空卡开始按时间顺序重演全部复习 —— 用于迟到的离线复习 */
export function replay(retention: number, createdAt: Date, logs: Array<{ reviewedAt: Date; rating: ReviewRating }>) {
  const f = scheduler(retention);
  // 补交的复习可能早于建卡时间（离线建卡、先复习后同步）：起点取两者更早者
  const first = logs[0]?.reviewedAt;
  let card = createEmptyCard(first && first < createdAt ? first : createdAt);
  const steps: Array<{ stateBefore: CardState; scheduledDaysAfter: number }> = [];
  for (const log of logs) {
    const before = STATE_BY_ENUM[card.state];
    card = f.next(card, log.reviewedAt, log.rating as Grade).card;
    steps.push({ stateBefore: before, scheduledDaysAfter: card.scheduled_days });
  }
  return { card, steps };
}

/* ───────────── API 映射 ───────────── */

const SRS_COLUMNS = ['state', 'due', 'stability', 'difficulty', 'scheduled_days', 'learning_steps', 'reps', 'lapses', 'last_review_at'];

export function cardToApi(row: Row): Card {
  const base = camelRow<Omit<Card, 'srs'>>(row, SRS_COLUMNS);
  const last = row.last_review_at as Date | null;
  const srs: FsrsState = {
    state: row.state as CardState,
    due: (row.due as Date).toISOString(),
    stability: round(row.stability as number),
    difficulty: round(row.difficulty as number),
    elapsedDays: last ? round((Date.now() - last.getTime()) / 86_400_000) : 0,
    scheduledDays: round(row.scheduled_days as number),
    reps: row.reps as number,
    lapses: row.lapses as number,
    lastReviewAt: last ? last.toISOString() : null,
  };
  return { ...base, srs };
}

export function reviewLogToApi(row: Row): ReviewLog {
  return {
    id: row.id as string,
    cardId: row.card_id as string,
    rating: row.rating as ReviewRating,
    reviewedAt: (row.reviewed_at as Date).toISOString(),
    durationMs: row.duration_ms as number,
    stateBefore: row.state_before as CardState,
    scheduledDaysAfter: round(row.scheduled_days_after as number),
    createdAt: (row.created_at as Date).toISOString(),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
