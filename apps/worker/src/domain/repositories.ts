import type {
  DueReviewCard,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
  VocabularyCreateRequest,
  VocabularyCreateResponse,
  VocabularyItem,
  VocabularyListQuery,
  VocabularyListResponse,
  VocabularyUpdateRequest,
} from '@voice-chat/shared';

export interface DailyDigestClaimResult {
  dispatch_id: string;
  already_dispatched: boolean;
  notifications_enabled: boolean;
  telegram_chat_id: string;
  due_cards: DueReviewCard[];
  claim_token?: string;
}

/** Trusted webhook context, never accepted from a public review request body. */
export interface TelegramMutationContext {
  updateId: number;
  chatId: string;
  messageId?: number;
  confirmationText?: string;
}

/** Metered features counted against per-user daily caps (`M9-03`). */
export type DailyUsageKind = 'chat_turn' | 'translation' | 'live_session';

export interface DailyUsageOutcome {
  allowed: boolean;
  used: number;
  cap: number;
}

/**
 * Repository abstraction for vocabulary storage (`AGENTS.md` Section 2).
 * Allows swapping Google Sheets/Apps Script with Cloudflare D1 without altering domain/routes.
 */
export interface VocabularyRepository {
  upsert(
    userId: string,
    requestId: string,
    input: VocabularyCreateRequest,
  ): Promise<VocabularyCreateResponse>;

  list(
    userId: string,
    requestId: string,
    query: VocabularyListQuery,
  ): Promise<VocabularyListResponse>;

  update(
    userId: string,
    requestId: string,
    wordId: string,
    input: VocabularyUpdateRequest,
  ): Promise<VocabularyItem>;

  softDelete(
    userId: string,
    requestId: string,
    wordId: string,
    eventId: string,
  ): Promise<{ word_id: string; deleted: boolean }>;
}

/**
 * Repository abstraction for Spaced Repetition reviews and daily digest dispatches (`AGENTS.md` Section 2).
 */
export interface ReviewRepository {
  listDue(userId: string, requestId: string, limit: number): Promise<{ items: DueReviewCard[] }>;

  preview(
    userId: string,
    requestId: string,
    cardId: string,
    nowIso?: string,
  ): Promise<import('@voice-chat/shared').ReviewPreviewResponse>;

  recordReview(
    userId: string,
    requestId: string,
    input: ReviewSubmitRequest,
    reviewedAtIso: string,
    telegram?: TelegramMutationContext,
  ): Promise<ReviewSubmitResponse>;

  getStats(
    userId: string,
    requestId: string,
    nowIso?: string,
  ): Promise<import('@voice-chat/shared').ReviewStatsResponse>;

  claimDailyDigest(
    userId: string,
    requestId: string,
    localDate: string,
    limit: number,
    nowIso?: string,
  ): Promise<DailyDigestClaimResult>;

  finishDailyDigest(
    userId: string,
    requestId: string,
    input: {
      dispatch_id: string;
      claim_token: string;
      status: 'sent' | 'failed' | 'unknown';
      message_id?: number;
    },
  ): Promise<{ updated: boolean }>;

  updateUserPreferences(
    userId: string,
    requestId: string,
    eventId: string,
    prefs: {
      telegram_chat_id?: string | undefined;
      notifications_enabled?: boolean | undefined;
      daily_review_limit?: number | undefined;
    },
    telegram?: TelegramMutationContext,
  ): Promise<{ updated: boolean; notifications_enabled: boolean }>;
  /**
   * Atomically checks and consumes one unit of a metered daily quota (`M9-03`).
   * Optional: adapters without durable counters (GAS mode, test doubles) simply skip enforcement.
   */
  checkAndConsumeUsage?(input: {
    userId: string;
    kind: DailyUsageKind;
    cap: number;
    localDate: string;
    nowIso: string;
  }): Promise<DailyUsageOutcome>;
  acceptTelegramCommand?(
    userId: string,
    requestId: string,
    updateId: number,
    chatId: string,
    payload: unknown,
  ): Promise<void>;
}
