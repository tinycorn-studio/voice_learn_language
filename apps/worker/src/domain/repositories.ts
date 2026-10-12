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

  recordReview(
    userId: string,
    requestId: string,
    input: ReviewSubmitRequest,
    reviewedAtIso: string,
  ): Promise<ReviewSubmitResponse>;

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
  ): Promise<{ updated: boolean; notifications_enabled: boolean }>;
}
