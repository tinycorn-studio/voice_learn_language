import {
  calculateNextReview,
  type DueReviewCard,
  type GasAction,
  type GasSignedEnvelope,
  type ReviewSubmitRequest,
  type ReviewSubmitResponse,
  type VocabularyCreateRequest,
  type VocabularyCreateResponse,
  type VocabularyItem,
  type VocabularyListQuery,
  type VocabularyListResponse,
  type VocabularyUpdateRequest,
} from '@voice-chat/shared';
import { bytesToBase64Url, constantTimeEqual } from '../auth/telegram-auth.js';
import { AppError } from '../domain/env.js';
import type {
  DailyDigestClaimResult,
  ReviewRepository,
  VocabularyRepository,
} from '../domain/repositories.js';

const encoder = new TextEncoder();

/**
 * Signs an exact JSON payload string with HMAC-SHA256 and encodes as unpadded base64url,
 * matching `Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '')` in `apps-script/Code.gs`.
 */
export async function signGasPayload(payload: string, sharedSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sharedSecret) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function verifyGasPayloadSignature(
  payload: string,
  signature: string,
  sharedSecret: string,
): Promise<boolean> {
  const expected = await signGasPayload(payload, sharedSecret);
  const cleanIncoming = signature.replace(/=+$/, '');
  return constantTimeEqual(cleanIncoming, expected);
}

export async function buildSignedGasEnvelope(params: {
  action: GasAction;
  eventId: string;
  userId: string;
  requestId: string;
  data: Record<string, unknown>;
  sharedSecret: string;
  issuedAtIso?: string;
}): Promise<GasSignedEnvelope> {
  const payloadObj = {
    action: params.action,
    event_id: params.eventId,
    issued_at: params.issuedAtIso ?? new Date().toISOString(),
    user_id: params.userId,
    request_id: params.requestId,
    data: params.data,
  };
  const payload = JSON.stringify(payloadObj);
  if (payload.length > 12000) {
    throw new AppError({
      code: 'INVALID_ARGUMENT',
      message: 'GAS payload exceeds maximum allowed size (12000 bytes)',
      status: 400,
    });
  }
  const signature = await signGasPayload(payload, params.sharedSecret);
  return { payload, signature };
}

interface GasJsonResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * Adapter that communicates with the Google Apps Script Web App (`doPost`) via HMAC-signed envelopes.
 * Parses business-level `{ ok: true|false }` JSON because GAS `ContentService` returns HTTP 200 even on errors.
 */
export class GasRepositoryAdapter implements VocabularyRepository, ReviewRepository {
  public constructor(
    private readonly gasExecUrl: string,
    private readonly gasSharedSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async callGas<T>(params: {
    action: GasAction;
    eventId: string;
    userId: string;
    requestId: string;
    data: Record<string, unknown>;
  }): Promise<T> {
    const envelope = await buildSignedGasEnvelope({
      ...params,
      sharedSecret: this.gasSharedSecret,
    });

    let res: Response;
    try {
      res = await this.fetchFn(this.gasExecUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(envelope),
      });
    } catch {
      throw new AppError({
        code: 'UNAVAILABLE',
        message: 'Google Apps Script endpoint unreachable',
        status: 503,
        retryable: true,
      });
    }

    if (res.status >= 500 || res.status === 429) {
      throw new AppError({
        code: 'UPSTREAM_ERROR',
        message: `Apps Script upstream returned HTTP ${res.status}`,
        status: 502,
        retryable: true,
      });
    }

    let body: GasJsonResponse<T>;
    try {
      body = (await res.json()) as GasJsonResponse<T>;
    } catch {
      throw new AppError({
        code: 'UPSTREAM_ERROR',
        message: 'Invalid JSON response from Apps Script',
        status: 502,
        retryable: true,
      });
    }

    if (!body.ok || body.data === undefined) {
      const errCode = body.error?.code ?? 'UPSTREAM_ERROR';
      if (errCode === 'FORBIDDEN') {
        throw new AppError({
          code: 'FORBIDDEN',
          message: body.error?.message ?? 'Forbidden by Apps Script owner policy',
          status: 403,
        });
      }
      if (errCode === 'CONFLICT' || errCode === 'VERSION_CONFLICT') {
        throw new AppError({
          code: 'CONFLICT',
          message: body.error?.message ?? 'Version conflict on vocabulary item',
          status: 409,
        });
      }
      if (errCode === 'NOT_FOUND') {
        throw new AppError({
          code: 'NOT_FOUND',
          message: body.error?.message ?? 'Requested vocabulary item not found',
          status: 404,
        });
      }
      throw new AppError({
        code: 'UPSTREAM_ERROR',
        message: body.error?.message ?? `Apps Script error: ${errCode}`,
        status: 502,
        retryable: errCode === 'INTERNAL_ERROR' || errCode === 'LOCK_TIMEOUT',
      });
    }

    return body.data;
  }

  public async upsert(
    userId: string,
    requestId: string,
    input: VocabularyCreateRequest,
  ): Promise<VocabularyCreateResponse> {
    return this.callGas<VocabularyCreateResponse>({
      action: 'vocabulary.upsert',
      eventId: input.event_id,
      userId,
      requestId,
      data: {
        word: input.word,
        lemma: input.lemma ?? input.word.toLowerCase(),
        part_of_speech: input.part_of_speech,
        sense_key: input.sense_key,
        meaning_vi: input.meaning_vi,
        ipa: input.ipa ?? '',
        example: input.example,
        source_excerpt: input.source_excerpt,
      },
    });
  }

  public async list(
    userId: string,
    requestId: string,
    query: VocabularyListQuery,
  ): Promise<VocabularyListResponse> {
    return this.callGas<VocabularyListResponse>({
      action: 'vocabulary.list',
      eventId: `list_${requestId.slice(0, 48)}`,
      userId,
      requestId,
      data: {
        cursor: query.cursor ?? null,
        limit: query.limit,
        search: query.search ?? '',
      },
    });
  }

  public async update(
    userId: string,
    requestId: string,
    wordId: string,
    input: VocabularyUpdateRequest,
  ): Promise<VocabularyItem> {
    return this.callGas<VocabularyItem>({
      action: 'vocabulary.update',
      eventId: input.event_id,
      userId,
      requestId,
      data: {
        word_id: wordId,
        meaning_vi: input.meaning_vi,
        example: input.example,
        part_of_speech: input.part_of_speech,
        sense_key: input.sense_key,
        version: input.version,
      },
    });
  }

  public async softDelete(
    userId: string,
    requestId: string,
    wordId: string,
    eventId: string,
  ): Promise<{ word_id: string; deleted: boolean }> {
    return this.callGas<{ word_id: string; deleted: boolean }>({
      action: 'vocabulary.delete',
      eventId,
      userId,
      requestId,
      data: {
        word_id: wordId,
      },
    });
  }

  public async listDue(
    userId: string,
    requestId: string,
    limit: number,
  ): Promise<{ items: DueReviewCard[] }> {
    return this.callGas<{ items: DueReviewCard[] }>({
      action: 'review.listDue',
      eventId: `due_${requestId.slice(0, 48)}`,
      userId,
      requestId,
      data: {
        limit,
        now_iso: new Date().toISOString(),
      },
    });
  }

  public async recordReview(
    userId: string,
    requestId: string,
    input: ReviewSubmitRequest,
    reviewedAtIso: string,
  ): Promise<ReviewSubmitResponse> {
    // Also pass precomputed deterministic SRS schedule helper callback or let GAS compute/validate
    void calculateNextReview;
    return this.callGas<ReviewSubmitResponse>({
      action: 'review.record',
      eventId: input.event_id,
      userId,
      requestId,
      data: {
        word_id: input.word_id,
        rating: input.rating,
        reviewed_at: reviewedAtIso,
      },
    });
  }

  public async claimDailyDigest(
    userId: string,
    requestId: string,
    localDate: string,
    limit: number,
  ): Promise<DailyDigestClaimResult> {
    return this.callGas<DailyDigestClaimResult>({
      action: 'review.claimDigest',
      eventId: `digest_${localDate}_${userId.replace(/[^a-zA-Z0-9]/g, '_')}`,
      userId,
      requestId,
      data: {
        local_date: localDate,
        limit,
        now_iso: new Date().toISOString(),
      },
    });
  }

  public async updateUserPreferences(
    userId: string,
    requestId: string,
    eventId: string,
    prefs: {
      telegram_chat_id?: string | undefined;
      notifications_enabled?: boolean | undefined;
      daily_review_limit?: number | undefined;
    },
  ): Promise<{ updated: boolean; notifications_enabled: boolean }> {
    return this.callGas<{ updated: boolean; notifications_enabled: boolean }>({
      action: 'user.preferences',
      eventId,
      userId,
      requestId,
      data: {
        ...prefs,
      },
    });
  }
}
