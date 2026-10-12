import type { ReviewRating, ReviewState } from '../contracts/api.js';

export interface SrsCardState {
  reviewState: ReviewState;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string;
}

export interface SrsScheduleResult extends SrsCardState {
  oldDueAt: string;
  oldIntervalDays: number;
}

const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3.0;
const DEFAULT_EASE_FACTOR = 2.5;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function clampEase(ease: number): number {
  const clamped = Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, ease));
  return Math.round(clamped * 100) / 100;
}

/**
 * @deprecated Legacy SM-2 fixtures only. Production uses fsrs-engine.ts (ADR-008).
 * Pure deterministic Spaced Repetition engine implementing the former SRS v1.
 *
 * Rules (`docs/16_SRS.md`):
 * - `again`: repetitions = 0, interval = 10 minutes (stored as `intervalDays = 0` for sub-day learning),
 *   `dueAt = now + 10m`, `ease = max(1.3, oldEase - 0.2)`, `reviewState = 'learning'`.
 * - `hard`: repetitions preserved (or 1 if coming from new), `intervalDays = max(1, ceil(oldIntervalDays * 1.2))`,
 *   `ease = max(1.3, oldEase - 0.15)`, `reviewState = 'review'`.
 * - `good`: if `repetitions === 0` -> 1 day; if `repetitions === 1` -> 3 days;
 *   otherwise `max(4, ceil(oldIntervalDays * oldEase))`; `repetitions += 1`; `ease` unchanged; `reviewState = 'review'`.
 * - `easy`: if `repetitions === 0` -> 4 days;
 *   otherwise `max(5, ceil(oldIntervalDays * oldEase * 1.3))`; `repetitions += 1`;
 *   `ease = min(3.0, oldEase + 0.15)`; `reviewState = 'review'`.
 */
export function calculateNextReview(
  current: SrsCardState,
  rating: ReviewRating,
  reviewedAtIso: string,
): SrsScheduleResult {
  const reviewedMs = Date.parse(reviewedAtIso);
  if (!Number.isFinite(reviewedMs)) {
    throw new Error(`Invalid reviewedAtIso timestamp: ${reviewedAtIso}`);
  }

  const oldEase = Number.isFinite(current.easeFactor)
    ? clampEase(current.easeFactor)
    : DEFAULT_EASE_FACTOR;
  const oldIntervalDays = Math.max(0, current.intervalDays);
  const oldRepetitions = Math.max(0, Math.trunc(current.repetitions));

  if (rating === 'again') {
    const nextEase = clampEase(oldEase - 0.2);
    const nextDueAt = new Date(reviewedMs + TEN_MINUTES_MS).toISOString();
    return {
      reviewState: 'learning',
      repetitions: 0,
      intervalDays: 0,
      easeFactor: nextEase,
      dueAt: nextDueAt,
      oldDueAt: current.dueAt,
      oldIntervalDays,
    };
  }

  if (rating === 'hard') {
    const nextEase = clampEase(oldEase - 0.15);
    const nextIntervalDays = Math.max(1, Math.ceil(oldIntervalDays * 1.2));
    const nextRepetitions = oldRepetitions === 0 ? 1 : oldRepetitions;
    const nextDueAt = new Date(reviewedMs + nextIntervalDays * ONE_DAY_MS).toISOString();
    return {
      reviewState: 'review',
      repetitions: nextRepetitions,
      intervalDays: nextIntervalDays,
      easeFactor: nextEase,
      dueAt: nextDueAt,
      oldDueAt: current.dueAt,
      oldIntervalDays,
    };
  }

  if (rating === 'good') {
    let nextIntervalDays: number;
    if (oldRepetitions === 0) {
      nextIntervalDays = 1;
    } else if (oldRepetitions === 1) {
      nextIntervalDays = 3;
    } else {
      nextIntervalDays = Math.max(4, Math.ceil(oldIntervalDays * oldEase));
    }
    const nextDueAt = new Date(reviewedMs + nextIntervalDays * ONE_DAY_MS).toISOString();
    return {
      reviewState: 'review',
      repetitions: oldRepetitions + 1,
      intervalDays: nextIntervalDays,
      easeFactor: oldEase,
      dueAt: nextDueAt,
      oldDueAt: current.dueAt,
      oldIntervalDays,
    };
  }

  // rating === 'easy'
  const nextEase = clampEase(oldEase + 0.15);
  const nextIntervalDays =
    oldRepetitions === 0 ? 4 : Math.max(5, Math.ceil(oldIntervalDays * oldEase * 1.3));
  const nextDueAt = new Date(reviewedMs + nextIntervalDays * ONE_DAY_MS).toISOString();
  return {
    reviewState: 'review',
    repetitions: oldRepetitions + 1,
    intervalDays: nextIntervalDays,
    easeFactor: nextEase,
    dueAt: nextDueAt,
    oldDueAt: current.dueAt,
    oldIntervalDays,
  };
}
