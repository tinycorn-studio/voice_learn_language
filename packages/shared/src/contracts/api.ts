import { z } from 'zod';

/**
 * Canonical voice session states required by `docs/00_PRODUCT_SCOPE.md`:
 * `listening / thinking / speaking / reconnecting / error / idle`.
 */
export const VOICE_SESSION_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'reconnecting',
  'error',
] as const;

export type VoiceSessionState = (typeof VOICE_SESSION_STATES)[number];

/**
 * Canonical parts of speech supported by vocabulary contract (`docs/08_API_CONTRACTS.md`).
 */
export const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'phrase',
  'idiom',
  'preposition',
  'conjunction',
  'pronoun',
  'interjection',
  'unknown',
] as const;

export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

/**
 * SRS review ratings (`docs/16_SRS.md`).
 */
export const REVIEW_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/**
 * SRS review states stored in `Words.review_state` (`docs/09_DATA_SCHEMA.md`).
 */
export const REVIEW_STATES = ['new', 'learning', 'review', 'suspended'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * Standard API error codes (`docs/08_API_CONTRACTS.md`).
 */
export const API_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'UNAVAILABLE',
  'TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorDetailSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
});

export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;

export interface ApiSuccessEnvelope<T> {
  ok: true;
  data: T;
  request_id: string;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: ApiErrorDetail;
  request_id: string;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

/**
 * POST /api/v1/auth/telegram contract (`docs/08_API_CONTRACTS.md`).
 */
export const telegramAuthRequestSchema = z.object({
  init_data: z.string().min(10).max(4096),
});

export type TelegramAuthRequest = z.infer<typeof telegramAuthRequestSchema>;

export const telegramAuthResponseSchema = z.object({
  session_token: z.string().min(16),
  expires_at: z.string().datetime(),
  user_id: z.string().regex(/^telegram:\d+$/),
});

export type TelegramAuthResponse = z.infer<typeof telegramAuthResponseSchema>;

/**
 * POST /api/v1/live-token contract (`docs/08_API_CONTRACTS.md`).
 */
export const liveTokenRequestSchema = z
  .object({
    session_purpose: z.literal('voice_chat').optional(),
  })
  .optional();

export type LiveTokenRequest = z.infer<typeof liveTokenRequestSchema>;

export const liveTokenResponseSchema = z.object({
  token: z.string().min(1),
  model: z.string().min(1),
  expires_at: z.string().datetime(),
});

export type LiveTokenResponse = z.infer<typeof liveTokenResponseSchema>;

/**
 * Event ID schema (UUIDv4 / UUIDv7 or safe alphanumeric token 12..128 chars matching GAS).
 */
export const eventIdSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]{12,128}$/);

/**
 * POST /api/v1/vocabulary request & response contracts (`docs/08_API_CONTRACTS.md`).
 */
export const vocabularyCreateRequestSchema = z.object({
  event_id: eventIdSchema,
  word: z.string().trim().min(1).max(120),
  lemma: z.string().trim().min(1).max(120).optional(),
  part_of_speech: z.enum(PARTS_OF_SPEECH).default('unknown'),
  sense_key: z.string().trim().min(1).max(100).default('default'),
  meaning_vi: z.string().trim().max(300).default(''),
  ipa: z.string().trim().max(120).optional(),
  example: z.string().trim().max(500).default(''),
  source_excerpt: z.string().trim().max(500).default(''),
});

export type VocabularyCreateRequest = z.infer<typeof vocabularyCreateRequestSchema>;

export const vocabularyCreateResponseSchema = z.object({
  word_id: z.string().min(3),
  created: z.boolean(),
  duplicate_event: z.boolean(),
});

export type VocabularyCreateResponse = z.infer<typeof vocabularyCreateResponseSchema>;

/**
 * Vocabulary item returned by GET /api/v1/vocabulary (`docs/08_API_CONTRACTS.md`, `docs/09_DATA_SCHEMA.md`).
 */
export const vocabularyItemSchema = z.object({
  word_id: z.string(),
  user_id: z.string(),
  word_key: z.string(),
  word: z.string(),
  lemma: z.string(),
  part_of_speech: z.enum(PARTS_OF_SPEECH),
  sense_key: z.string(),
  meaning_vi: z.string(),
  ipa: z.string(),
  example: z.string(),
  source_excerpt: z.string(),
  created_at: z.string(),
  last_asked_at: z.string(),
  times_asked: z.number().int().nonnegative(),
  review_state: z.enum(REVIEW_STATES),
  repetitions: z.number().int().nonnegative(),
  interval_days: z.number().nonnegative(),
  ease_factor: z.number().min(1.3).max(3.0),
  due_at: z.string(),
  last_reviewed_at: z.string(),
  version: z.number().int().positive(),
  deleted_at: z.string(),
});

export type VocabularyItem = z.infer<typeof vocabularyItemSchema>;

export const vocabularyListQuerySchema = z.object({
  cursor: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(120).optional(),
});

export type VocabularyListQuery = z.infer<typeof vocabularyListQuerySchema>;

export const vocabularyListResponseSchema = z.object({
  items: z.array(vocabularyItemSchema),
  next_cursor: z.string().nullable(),
});

export type VocabularyListResponse = z.infer<typeof vocabularyListResponseSchema>;

/**
 * PATCH /api/v1/vocabulary/:id contract (`docs/08_API_CONTRACTS.md`).
 */
export const vocabularyUpdateRequestSchema = z.object({
  event_id: eventIdSchema,
  meaning_vi: z.string().trim().max(300).optional(),
  example: z.string().trim().max(500).optional(),
  part_of_speech: z.enum(PARTS_OF_SPEECH).optional(),
  sense_key: z.string().trim().min(1).max(100).optional(),
  version: z.number().int().positive(),
});

export type VocabularyUpdateRequest = z.infer<typeof vocabularyUpdateRequestSchema>;

/**
 * GET /api/v1/reviews/due & POST /api/v1/reviews contracts (`docs/08_API_CONTRACTS.md`).
 */
export const dueReviewCardSchema = z.object({
  review_id: z.string(),
  word_id: z.string(),
  word: z.string(),
  lemma: z.string(),
  part_of_speech: z.enum(PARTS_OF_SPEECH),
  meaning_vi: z.string(),
  example: z.string(),
  source_excerpt: z.string(),
  due_at: z.string(),
  review_state: z.enum(REVIEW_STATES),
  repetitions: z.number().int().nonnegative(),
  interval_days: z.number().nonnegative(),
  ease_factor: z.number().min(1.3).max(3.0),
  version: z.number().int().positive(),
});

export type DueReviewCard = z.infer<typeof dueReviewCardSchema>;

export const reviewSubmitRequestSchema = z.object({
  event_id: eventIdSchema,
  word_id: z.string().min(3).max(120),
  rating: z.enum(REVIEW_RATINGS),
  reviewed_at: z.string().datetime().optional(),
  version: z.number().int().positive().optional(),
});

export type ReviewSubmitRequest = z.infer<typeof reviewSubmitRequestSchema>;

export const reviewSubmitResponseSchema = z.object({
  review_id: z.string(),
  word_id: z.string(),
  next_due_at: z.string().datetime(),
  interval_days: z.number().nonnegative(),
  repetitions: z.number().int().nonnegative(),
  ease_factor: z.number().min(1.3).max(3.0),
  review_state: z.enum(REVIEW_STATES),
  duplicate_event: z.boolean(),
});

export type ReviewSubmitResponse = z.infer<typeof reviewSubmitResponseSchema>;

/**
 * GAS HMAC internal envelope (`docs/08_API_CONTRACTS.md`).
 */
export const GAS_ACTIONS = [
  'vocabulary.upsert',
  'vocabulary.list',
  'vocabulary.update',
  'vocabulary.delete',
  'review.listDue',
  'review.record',
  'review.claimDigest',
  'review.finishDigest',
  'user.preferences',
] as const;

export type GasAction = (typeof GAS_ACTIONS)[number];

export const gasEventPayloadSchema = z.object({
  action: z.enum(GAS_ACTIONS),
  event_id: eventIdSchema,
  issued_at: z.string().datetime(),
  user_id: z.string().regex(/^telegram:\d+$/),
  request_id: z.string().min(1).max(80),
  data: z.record(z.unknown()),
});

export type GasEventPayload = z.infer<typeof gasEventPayloadSchema>;

export const gasSignedEnvelopeSchema = z.object({
  payload: z.string().min(2).max(12000),
  signature: z.string().min(16).max(256),
});

export type GasSignedEnvelope = z.infer<typeof gasSignedEnvelopeSchema>;

export const dailyDigestClaimSchema = z.object({
  dispatch_id: z.string(),
  already_dispatched: z.boolean(),
  notifications_enabled: z.boolean(),
  telegram_chat_id: z.string(),
  due_cards: z.array(dueReviewCardSchema),
  claim_token: z.string().optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      chat: z.object({ id: z.number().int() }).optional(),
      from: z.object({ id: z.number().int() }).optional(),
      text: z.string().max(4096).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string().max(256),
      from: z.object({ id: z.number().int() }),
      message: z.object({ chat: z.object({ id: z.number().int() }) }).optional(),
      data: z.string().max(64).optional(),
    })
    .optional(),
});
