import {
  createEmptyCard,
  fsrs,
  Rating as TsFsrsRating,
  State as TsFsrsState,
  type Card as TsFsrsCard,
  type FSRSParameters,
  type Grade,
  type ReviewLog,
  checkParameters,
  FSRSVersion,
} from 'ts-fsrs';
import { z } from 'zod';
import type { ReviewPreviewResponse, ReviewRating } from '../contracts/api.js';

export const FSRS_SCHEDULER_VERSION = `ts-fsrs@${FSRSVersion}`;
export const FSRS_PARAMETERS_VERSION = 'default-v1';

/**
 * Canonical FSRS state strings matching ts-fsrs State enum.
 */
export const FSRS_CARD_STATES = ['New', 'Learning', 'Review', 'Relearning'] as const;
export type FsrsCardState = (typeof FSRS_CARD_STATES)[number];

/**
 * Centralized Single Source of Truth for FSRS configuration (`AGENTS.md`, ADR-008).
 * Desired retention: 0.90 (90%), max interval 36500 days (~100 years), fuzz disabled for deterministic tests.
 */
export const DEFAULT_FSRS_CONFIG = Object.freeze({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
});

export const fsrsConfigSchema = z
  .object({
    request_retention: z.number().min(0.7).max(0.99).default(DEFAULT_FSRS_CONFIG.request_retention),
    maximum_interval: z
      .number()
      .int()
      .min(1)
      .max(36500)
      .default(DEFAULT_FSRS_CONFIG.maximum_interval),
    enable_fuzz: z.literal(false).default(DEFAULT_FSRS_CONFIG.enable_fuzz),
    timezone: z.enum(['Asia/Ho_Chi_Minh', 'Asia/Bangkok']).default('Asia/Ho_Chi_Minh'),
    parameters_version: z.string().min(1).max(80).default(FSRS_PARAMETERS_VERSION),
    w: z
      .array(z.number().finite())
      .min(17)
      .max(21)
      .optional()
      .superRefine((value, ctx) => {
        if (value) {
          try {
            checkParameters(value);
          } catch {
            ctx.addIssue({ code: 'custom', message: 'Invalid FSRS weights' });
          }
        }
      }),
  })
  .strict();

export type FsrsConfig = z.infer<typeof fsrsConfigSchema>;
type FsrsOverrides = Partial<FSRSParameters> | FsrsConfig;

function createScheduler(config: FsrsConfig) {
  return fsrs({
    request_retention: config.request_retention,
    maximum_interval: config.maximum_interval,
    enable_fuzz: config.enable_fuzz,
    ...(config.w ? { w: config.w } : {}),
  });
}

/**
 * Persistent FSRS Card representation stored in Google Sheets 'Cards' tab.
 */
export const fsrsCardSchema = z.object({
  card_id: z.string().min(3),
  user_id: z.string().min(3),
  word_id: z.string().min(3),
  card_type: z.string().default('default'),
  state: z.enum(FSRS_CARD_STATES),
  due_at_utc: z.string().datetime(),
  stability: z.number().finite().nonnegative(),
  difficulty: z.number().min(0).max(10),
  elapsed_days: z.number().nonnegative(),
  scheduled_days: z.number().nonnegative(),
  learning_steps: z.number().int().nonnegative().default(0),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  last_review_at_utc: z
    .union([z.string().datetime(), z.literal('')])
    .nullish()
    .transform((val) => (val && val.trim() ? val : null)),
  created_at_utc: z.string().datetime(),
  updated_at_utc: z.string().datetime(),
  row_version: z.number().int().positive(),
  scheduler_version: z.string(),
  parameters_version: z.string(),
  is_suspended: z.boolean().default(false),
  legacy_snapshot_json: z.string().optional(),
});

export type FsrsCard = z.infer<typeof fsrsCardSchema>;

export interface FsrsPreviewItem {
  rating: ReviewRating;
  state: FsrsCardState;
  next_due_at: string;
  interval_days: number;
  stability: number;
  difficulty: number;
}

export type FsrsPreviewResult = Record<ReviewRating, FsrsPreviewItem>;

export interface FsrsScheduleResult {
  next_card: FsrsCard;
  review_log: ReviewLog;
  review_log_json: string;
}

/**
 * Mapping between string ReviewRating ('again'|'hard'|'good'|'easy') and ts-fsrs Grade enum.
 */
export function ratingToTsFsrs(rating: ReviewRating): Grade {
  switch (rating) {
    case 'again':
      return TsFsrsRating.Again as Grade;
    case 'hard':
      return TsFsrsRating.Hard as Grade;
    case 'good':
      return TsFsrsRating.Good as Grade;
    case 'easy':
      return TsFsrsRating.Easy as Grade;
  }
}

export function tsFsrsRatingToString(rating: TsFsrsRating): ReviewRating {
  switch (rating) {
    case TsFsrsRating.Again:
      return 'again';
    case TsFsrsRating.Hard:
      return 'hard';
    case TsFsrsRating.Good:
      return 'good';
    case TsFsrsRating.Easy:
      return 'easy';
    default:
      return 'good';
  }
}

export function stateToTsFsrs(state: FsrsCardState): TsFsrsState {
  switch (state) {
    case 'New':
      return TsFsrsState.New;
    case 'Learning':
      return TsFsrsState.Learning;
    case 'Review':
      return TsFsrsState.Review;
    case 'Relearning':
      return TsFsrsState.Relearning;
  }
}

export function tsFsrsStateToString(state: TsFsrsState): FsrsCardState {
  switch (state) {
    case TsFsrsState.New:
      return 'New';
    case TsFsrsState.Learning:
      return 'Learning';
    case TsFsrsState.Review:
      return 'Review';
    case TsFsrsState.Relearning:
      return 'Relearning';
  }
}

/**
 * Convert a persistent FsrsCard to ts-fsrs Card domain object.
 */
export function toTsFsrsCard(card: FsrsCard): TsFsrsCard {
  const tsCard: TsFsrsCard = {
    due: new Date(card.due_at_utc),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: stateToTsFsrs(card.state),
  };
  if (card.last_review_at_utc) {
    tsCard.last_review = new Date(card.last_review_at_utc);
  }
  return tsCard;
}

/**
 * Factory for creating an initial FSRS card using official `createEmptyCard()`.
 */
export function createInitialFsrsCard(params: {
  cardId: string;
  userId: string;
  wordId: string;
  cardType?: string;
  nowIso?: string;
}): FsrsCard {
  const now = params.nowIso ? new Date(params.nowIso) : new Date();
  const empty = createEmptyCard(now);
  const nowIso = now.toISOString();

  return {
    card_id: params.cardId,
    user_id: params.userId,
    word_id: params.wordId,
    card_type: params.cardType ?? 'default',
    state: 'New',
    due_at_utc: empty.due.toISOString(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsed_days: empty.elapsed_days,
    scheduled_days: empty.scheduled_days,
    learning_steps: empty.learning_steps,
    reps: empty.reps,
    lapses: empty.lapses,
    last_review_at_utc: null,
    created_at_utc: nowIso,
    updated_at_utc: nowIso,
    row_version: 1,
    scheduler_version: FSRS_SCHEDULER_VERSION,
    parameters_version: FSRS_PARAMETERS_VERSION,
    is_suspended: false,
  };
}

/**
 * Preview review outcomes for all 4 ratings without modifying card state.
 * Uses `scheduler.repeat()` from official `ts-fsrs`.
 */
export function previewFsrsCard(
  card: FsrsCard,
  nowIso?: string,
  params?: FsrsOverrides,
): FsrsPreviewResult {
  const now = nowIso ? new Date(nowIso) : new Date();
  const config = fsrsConfigSchema.parse(params ?? {});
  const f = createScheduler(config);
  fsrsCardSchema.parse(card);
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid preview timestamp');

  const tsCard = toTsFsrsCard(card);
  const repeat = f.repeat(tsCard, now);

  const ratings: ReviewRating[] = ['again', 'hard', 'good', 'easy'];
  const result = {} as FsrsPreviewResult;

  for (const r of ratings) {
    const fsrsRating = ratingToTsFsrs(r);
    const item = repeat[fsrsRating];
    const nextDue = item.card.due.toISOString();
    const intervalDays = item.card.scheduled_days;

    result[r] = {
      rating: r,
      state: tsFsrsStateToString(item.card.state),
      next_due_at: nextDue,
      interval_days: intervalDays,
      stability: Math.round(item.card.stability * 10000) / 10000,
      difficulty: Math.round(item.card.difficulty * 10000) / 10000,
    };
  }

  return result;
}

/**
 * Apply a confirmed rating to an FSRS card.
 * Uses official `scheduler.next()` from `ts-fsrs`.
 */
export function scheduleNextFsrsReview(
  card: FsrsCard,
  rating: ReviewRating,
  reviewedAtIso: string,
  params?: FsrsOverrides,
): FsrsScheduleResult {
  const reviewedAt = new Date(reviewedAtIso);
  if (!Number.isFinite(reviewedAt.getTime())) {
    throw new Error(`Invalid reviewedAtIso timestamp: ${reviewedAtIso}`);
  }

  const config = fsrsConfigSchema.parse(params ?? {});
  const f = createScheduler(config);
  fsrsCardSchema.parse(card);

  const tsCard = toTsFsrsCard(card);
  const fsrsRating = ratingToTsFsrs(rating);
  const nextItem = f.next(tsCard, reviewedAt, fsrsRating);

  const nextStateStr = tsFsrsStateToString(nextItem.card.state);
  const nextDueIso = nextItem.card.due.toISOString();

  const nextCard: FsrsCard = {
    ...card,
    state: nextStateStr,
    due_at_utc: nextDueIso,
    stability: Math.round(nextItem.card.stability * 10000) / 10000,
    difficulty: Math.round(nextItem.card.difficulty * 10000) / 10000,
    elapsed_days: nextItem.card.elapsed_days,
    scheduled_days: nextItem.card.scheduled_days,
    learning_steps: nextItem.card.learning_steps,
    reps: nextItem.card.reps,
    lapses: nextItem.card.lapses,
    last_review_at_utc: reviewedAtIso,
    updated_at_utc: reviewedAtIso,
    row_version: card.row_version + 1,
    scheduler_version: FSRS_SCHEDULER_VERSION,
    parameters_version: config.parameters_version,
  };

  const reviewLog = nextItem.log;

  return {
    next_card: nextCard,
    review_log: reviewLog,
    review_log_json: JSON.stringify(reviewLog),
  };
}

/**
 * Format FSRS preview outcomes into the standard API ReviewPreviewResponse.
 */
export function previewCardToResponse(
  card: FsrsCard,
  nowIso?: string,
  params?: FsrsOverrides,
): ReviewPreviewResponse {
  const preview = previewFsrsCard(card, nowIso, params);
  return {
    card_id: card.card_id,
    word_id: card.word_id,
    row_version: card.row_version,
    preview,
  };
}
