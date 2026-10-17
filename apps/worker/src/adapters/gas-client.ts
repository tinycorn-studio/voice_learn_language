import { z } from 'zod';
import {
  dailyDigestClaimSchema,
  dueReviewCardSchema,
  reviewPreviewResponseSchema,
  reviewStatsResponseSchema,
  reviewSubmitResponseSchema,
  vocabularyCreateResponseSchema,
  vocabularyItemSchema,
  vocabularyListResponseSchema,
  fsrsCardSchema,
  fsrsConfigSchema,
  previewCardToResponse,
  scheduleNextFsrsReview,
  type DueReviewCard,
  type FsrsCard,
  type FsrsConfig,
  type GasAction,
  type GasSignedEnvelope,
  type ReviewPreviewResponse,
  type ReviewStatsResponse,
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
import { AppError, logStructured } from '../domain/env.js';
import type {
  DailyDigestClaimResult,
  ReviewRepository,
  VocabularyRepository,
} from '../domain/repositories.js';

const encoder = new TextEncoder();
const HMAC_KEY_CACHE_LIMIT = 4;
const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

/** Reuses the imported HMAC key per isolate (`M9-03`): `importKey` costs CPU on every signed call. */
function importHmacKey(sharedSecret: string): Promise<CryptoKey> {
  const cached = hmacKeyCache.get(sharedSecret);
  if (cached) return cached;
  const keyPromise = crypto.subtle.importKey(
    'raw',
    encoder.encode(sharedSecret) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  hmacKeyCache.set(sharedSecret, keyPromise);
  if (hmacKeyCache.size > HMAC_KEY_CACHE_LIMIT) {
    const oldest = hmacKeyCache.keys().next().value;
    if (oldest !== undefined && oldest !== sharedSecret) hmacKeyCache.delete(oldest);
  }
  keyPromise.catch(() => {
    if (hmacKeyCache.get(sharedSecret) === keyPromise) hmacKeyCache.delete(sharedSecret);
  });
  return keyPromise;
}

/**
 * Signs an exact JSON payload string with HMAC-SHA256 and encodes as unpadded base64url,
 * matching `Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '')` in `apps-script/Code.gs`.
 */
export async function signGasPayload(payload: string, sharedSecret: string): Promise<string> {
  const key = await importHmacKey(sharedSecret);
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
    const started = Date.now();
    try {
      // Workers native fetch checks its global receiver, even when injected into an adapter.
      res = await this.fetchFn.call(globalThis, this.gasExecUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(15000),
      });
    } catch (failure) {
      const exceptionName =
        failure instanceof Error &&
        ['TypeError', 'Error', 'AbortError', 'TimeoutError'].includes(failure.name)
          ? failure.name
          : 'Other';
      const reason =
        failure instanceof Error && failure.message.includes('Illegal invocation')
          ? 'ILLEGAL_INVOCATION'
          : exceptionName === 'AbortError' || exceptionName === 'TimeoutError'
            ? 'TIMEOUT'
            : 'FETCH_FAILED';
      // Retain correlation and category only: endpoint, signed payload and raw errors may contain secrets/PII.
      logStructured('warn', 'gas_fetch_failed', params.requestId, {
        action: params.action,
        phase: 'fetch',
        reason,
        exception_name: exceptionName,
        duration_ms: Math.max(0, Date.now() - started),
        http_status: null,
      });
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

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new AppError({
        code: 'UPSTREAM_ERROR',
        message: 'Invalid JSON response from Apps Script',
        status: 502,
        retryable: true,
      });
    }

    const responseEnvelope = z
      .discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), data: z.unknown() }),
        z.object({
          ok: z.literal(false),
          error: z.object({ code: z.string(), message: z.string() }),
        }),
      ])
      .safeParse(raw);
    if (!responseEnvelope.success)
      throw new AppError({
        code: 'UPSTREAM_ERROR',
        message: 'Invalid Apps Script response envelope',
        status: 502,
      });
    const body = responseEnvelope.data;

    if (!body.ok) {
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

    const responseSchemas = {
      'vocabulary.upsert': vocabularyCreateResponseSchema,
      'vocabulary.list': vocabularyListResponseSchema,
      'vocabulary.update': vocabularyItemSchema,
      'vocabulary.delete': z.object({ word_id: z.string(), deleted: z.boolean() }),
      'card.get': z.object({ card: fsrsCardSchema, settings: z.unknown().optional() }),
      'review.listDue': z.object({ items: z.array(dueReviewCardSchema) }),
      'review.preview': reviewPreviewResponseSchema,
      'review.record': reviewSubmitResponseSchema,
      'review.lookup': z.object({ result: reviewSubmitResponseSchema.nullable() }),
      'review.stats': reviewStatsResponseSchema,
      'review.claimDigest': dailyDigestClaimSchema,
      'review.finishDigest': z.object({ updated: z.boolean() }),
      'user.preferences': z.object({ updated: z.boolean(), notifications_enabled: z.boolean() }),
      'mirror.applyBatch': z.object({ applied_event_ids: z.array(z.string()) }),
      'migration.schemaV3': z.object({
        migrated_cards: z.number().int().nonnegative(),
        status: z.string(),
      }),
    };

    const validated = responseSchemas[params.action].safeParse(body.data);
    if (!validated.success)
      throw new AppError({
        code: 'UPSTREAM_ERROR',
        message: 'Invalid Apps Script response contract',
        status: 502,
      });
    logStructured('info', 'repository_operation_complete', params.requestId, {
      backend: 'gas',
      action: params.action,
      duration_ms: Math.max(0, Date.now() - started),
      http_status: res.status,
    });
    return validated.data as T;
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

  public async getCard(
    userId: string,
    requestId: string,
    cardIdOrWordId: string,
  ): Promise<FsrsCard> {
    return (await this.getCardContext(userId, requestId, cardIdOrWordId)).card;
  }

  private async getCardContext(
    userId: string,
    requestId: string,
    cardIdOrWordId: string,
  ): Promise<{ card: FsrsCard; config: FsrsConfig }> {
    const res = await this.callGas<{ card: FsrsCard; settings?: unknown }>({
      action: 'card.get',
      eventId: `card_${requestId.slice(0, 48)}`,
      userId,
      requestId,
      data: {
        card_id: cardIdOrWordId,
        word_id: cardIdOrWordId,
      },
    });
    const config = fsrsConfigSchema.safeParse(res.settings ?? {});
    if (!config.success)
      throw new AppError({ code: 'UPSTREAM_ERROR', message: 'Invalid FSRS settings', status: 502 });
    return { card: res.card, config: config.data };
  }

  public async preview(
    userId: string,
    requestId: string,
    cardId: string,
    nowIso = new Date().toISOString(),
  ): Promise<ReviewPreviewResponse> {
    const { card, config } = await this.getCardContext(userId, requestId, cardId);
    return previewCardToResponse(card, nowIso, config);
  }

  public async recordReview(
    userId: string,
    requestId: string,
    input: ReviewSubmitRequest,
    reviewedAtIso: string,
  ): Promise<ReviewSubmitResponse> {
    const targetId = input.card_id ?? input.word_id;
    if (!targetId) {
      throw new AppError({
        code: 'INVALID_ARGUMENT',
        message: 'Either card_id or word_id is required',
        status: 400,
      });
    }

    const clientRequest = {
      card_id: input.card_id ?? null,
      word_id: input.word_id ?? null,
      rating: input.rating,
      expected_version: input.expected_version ?? null,
      version: input.version ?? null,
    };
    // Replay before reading a card: it may have changed, been suspended or deleted.
    const replay = await this.callGas<{ result: ReviewSubmitResponse | null }>({
      action: 'review.lookup',
      eventId: input.event_id,
      userId,
      requestId,
      data: { client_request: clientRequest },
    });
    if (replay.result) return replay.result;
    const { card, config } = await this.getCardContext(userId, requestId, targetId);
    if (input.word_id && input.word_id !== card.word_id)
      throw new AppError({
        code: 'INVALID_ARGUMENT',
        message: 'Card does not belong to requested word',
        status: 400,
      });
    const expectedVer = input.expected_version ?? input.version;
    if (expectedVer !== undefined && expectedVer !== card.row_version)
      throw new AppError({ code: 'CONFLICT', message: 'Review card is stale', status: 409 });
    const scheduled = scheduleNextFsrsReview(card, input.rating, reviewedAtIso, config);

    return this.callGas<ReviewSubmitResponse>({
      action: 'review.record',
      eventId: input.event_id,
      userId,
      requestId,
      data: {
        card_id: card.card_id,
        word_id: card.word_id,
        rating: input.rating,
        reviewed_at: reviewedAtIso,
        expected_version: expectedVer ?? card.row_version,
        version: expectedVer ?? card.row_version,
        fsrs_card: scheduled.next_card,
        fsrs_review_log: scheduled.review_log,
        client_request: clientRequest,
      },
    });
  }

  public async getStats(
    userId: string,
    requestId: string,
    nowIso = new Date().toISOString(),
  ): Promise<ReviewStatsResponse> {
    return this.callGas<ReviewStatsResponse>({
      action: 'review.stats',
      eventId: `stats_${requestId.slice(0, 48)}`,
      userId,
      requestId,
      data: {
        now_iso: nowIso,
      },
    });
  }

  public async claimDailyDigest(
    userId: string,
    requestId: string,
    localDate: string,
    limit: number,
    nowIso = new Date().toISOString(),
  ): Promise<DailyDigestClaimResult> {
    return this.callGas<DailyDigestClaimResult>({
      action: 'review.claimDigest',
      eventId: `digest_${localDate}_${userId.replace(/[^a-zA-Z0-9]/g, '_')}`,
      userId,
      requestId,
      data: {
        local_date: localDate,
        limit,
        now_iso: nowIso,
      },
    });
  }

  public async finishDailyDigest(
    userId: string,
    requestId: string,
    input: {
      dispatch_id: string;
      claim_token: string;
      status: 'sent' | 'failed' | 'unknown';
      message_id?: number;
    },
  ): Promise<{ updated: boolean }> {
    return this.callGas<{ updated: boolean }>({
      action: 'review.finishDigest',
      eventId: `finish_${input.claim_token}`,
      userId,
      requestId,
      data: input,
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
