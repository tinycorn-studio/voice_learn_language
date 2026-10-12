import {
  formatLocalDateAsiaHoChiMinh,
  liveTokenRequestSchema,
  reviewSubmitRequestSchema,
  telegramAuthRequestSchema,
  telegramUpdateSchema,
  vocabularyCreateRequestSchema,
  vocabularyListQuerySchema,
  vocabularyUpdateRequestSchema,
  type ReviewRating,
} from '@voice-chat/shared';
import { GasRepositoryAdapter } from './adapters/gas-client.js';
import { mintGeminiEphemeralToken } from './adapters/gemini-token-issuer.js';
import { TelegramBotClient } from './adapters/telegram-bot-client.js';
import {
  issueSessionToken,
  verifySessionToken,
  verifyTelegramInitData,
  verifyTelegramWebhookSecret,
} from './auth/telegram-auth.js';
import { AppError, jsonEnvelopeResponse, logStructured, type WorkerEnv } from './domain/env.js';
import type { ReviewRepository, VocabularyRepository } from './domain/repositories.js';

export interface WorkerDependencies {
  fetchFn?: typeof fetch;
  vocabRepo?: VocabularyRepository;
  reviewRepo?: ReviewRepository;
  nowMs?: () => number;
}

/**
 * Simple bounded in-memory sliding-window rate limiter & Telegram `update_id` deduplicator per isolate.
 */
export class SecurityStateStore {
  private readonly liveTokenHits = new Map<string, number[]>();
  private readonly processedUpdateIds = new Set<number>();
  private readonly pendingUpdates = new Map<number, Promise<Response>>();

  /** Cache only completed updates; repository event IDs protect retries across isolates. */
  public async processTelegramUpdate(
    updateId: number,
    requestId: string,
    process: () => Promise<Response>,
  ): Promise<Response> {
    if (this.processedUpdateIds.has(updateId)) {
      return jsonEnvelopeResponse(
        { ok: true, data: { duplicate_update: true }, request_id: requestId },
        200,
      );
    }
    const pending = this.pendingUpdates.get(updateId);
    if (pending) return (await pending).clone();
    const work = process();
    this.pendingUpdates.set(updateId, work);
    try {
      const response = await work;
      if (response.ok) this.markTelegramUpdateProcessed(updateId);
      return response.clone();
    } finally {
      this.pendingUpdates.delete(updateId);
    }
  }

  public checkLiveTokenRateLimit(userId: string, nowMs: number, maxPerMinute = 5): void {
    const windowStart = nowMs - 60_000;
    const history = (this.liveTokenHits.get(userId) ?? []).filter((ts) => ts > windowStart);
    if (history.length >= maxPerMinute) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many live token requests. Please wait a minute before reconnecting.',
        status: 429,
        retryable: true,
      });
    }
    history.push(nowMs);
    this.liveTokenHits.set(userId, history);
  }

  public markTelegramUpdateProcessed(updateId: number): boolean {
    if (this.processedUpdateIds.has(updateId)) {
      return false;
    }
    this.processedUpdateIds.add(updateId);
    if (this.processedUpdateIds.size > 1000) {
      const oldest = this.processedUpdateIds.values().next().value;
      if (oldest !== undefined) {
        this.processedUpdateIds.delete(oldest);
      }
    }
    return true;
  }
}

const defaultSecurityStore = new SecurityStateStore();

function resolveCorsHeaders(request: Request, env: WorkerEnv): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowedOrigin = env.ALLOWED_ORIGIN?.trim() ?? '';
  const isLocalDev =
    env.ENVIRONMENT === 'development' &&
    (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173');

  if (origin && (origin === allowedOrigin || isLocalDev)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-request-id',
      'access-control-max-age': '86400',
      vary: 'Origin',
    };
  }
  return {};
}

function getSigningSecret(env: WorkerEnv): string {
  return env.SESSION_SIGNING_SECRET ?? env.GAS_SHARED_SECRET;
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDependencies = {},
  securityStore: SecurityStateStore = defaultSecurityStore,
): Promise<Response> {
  const requestId = request.headers.get('x-request-id')?.trim().slice(0, 64) || crypto.randomUUID();
  const corsHeaders = resolveCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const fetchFn = deps.fetchFn ?? fetch;

  const gasAdapter = new GasRepositoryAdapter(env.GAS_EXEC_URL, env.GAS_SHARED_SECRET, fetchFn);
  const vocabRepo = deps.vocabRepo ?? gasAdapter;
  const reviewRepo = deps.reviewRepo ?? gasAdapter;

  try {
    // 1. GET /health
    if (request.method === 'GET' && path === '/health') {
      return jsonEnvelopeResponse(
        {
          ok: true,
          data: {
            status: 'healthy',
            service: 'voice-chat-worker',
            version: '0.1.0',
            timestamp: new Date(nowMs).toISOString(),
          },
          request_id: requestId,
        },
        200,
        corsHeaders,
      );
    }

    // 2. POST /api/v1/auth/telegram
    if (request.method === 'POST' && path === '/api/v1/auth/telegram') {
      const rawJson = await parseRequestJson(request);
      const parsed = telegramAuthRequestSchema.safeParse(rawJson);
      if (!parsed.success) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid auth request body',
          status: 400,
        });
      }

      const verifiedUser = await verifyTelegramInitData({
        initData: parsed.data.init_data,
        botToken: env.TELEGRAM_BOT_TOKEN,
        ownerTelegramId: env.OWNER_TELEGRAM_ID,
        nowEpochSeconds: Math.floor(nowMs / 1000),
      });

      const session = await issueSessionToken({
        userId: verifiedUser.userId,
        signingSecret: getSigningSecret(env),
        nowEpochSeconds: Math.floor(nowMs / 1000),
      });

      return jsonEnvelopeResponse(
        {
          ok: true,
          data: {
            session_token: session.token,
            expires_at: session.expiresAt,
            user_id: verifiedUser.userId,
          },
          request_id: requestId,
        },
        200,
        {
          ...corsHeaders,
          'cache-control': 'no-store',
        },
      );
    }

    // 3. POST /telegram/webhook (Bot API updates & inline quiz callbacks)
    if (request.method === 'POST' && path === '/telegram/webhook') {
      verifyTelegramWebhookSecret(
        request.headers.get('x-telegram-bot-api-secret-token'),
        env.TELEGRAM_WEBHOOK_SECRET,
      );

      const parsedUpdate = telegramUpdateSchema.safeParse(await parseRequestJson(request));
      if (!parsedUpdate.success) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid Telegram update',
          status: 400,
        });
      }

      const update = parsedUpdate.data;
      return await securityStore.processTelegramUpdate(update.update_id, requestId, async () => {
        const ownerNumericId = Number(env.OWNER_TELEGRAM_ID.trim());
        const botClient = new TelegramBotClient(env.TELEGRAM_BOT_TOKEN, fetchFn);

        if (update.callback_query) {
          const cb = update.callback_query;
          if (cb.from?.id !== ownerNumericId) {
            throw new AppError({
              code: 'FORBIDDEN',
              message: 'Callback sender is not authorized owner',
              status: 403,
            });
          }
          const cbData = cb.data ?? '';
          const match = /^r:([a-zA-Z0-9_-]{2,64}):(again|hard|good|easy)(?::([1-9]\d{0,9}))?$/.exec(
            cbData,
          );
          if (!match || !match[1] || !match[2]) {
            throw new AppError({
              code: 'INVALID_ARGUMENT',
              message: 'Malformed callback_data payload',
              status: 400,
            });
          }

          const cardIdOrWordId = match[1];
          const rating = match[2] as ReviewRating;
          const eventId = `tgcb_${update.update_id}_${cardIdOrWordId}`.slice(0, 80);
          const result = await reviewRepo.recordReview(
            `telegram:${ownerNumericId}`,
            requestId,
            {
              event_id: eventId.length >= 12 ? eventId : `${eventId}_review`,
              // The repository resolves legacy Word aliases; Card IDs need no prefix.
              card_id: cardIdOrWordId,
              rating,
              ...(match[3] ? { version: Number(match[3]) } : {}),
            },
            new Date(nowMs).toISOString(),
          );

          if (cb.id) {
            await botClient.answerCallbackQuery({
              callbackQueryId: cb.id,
              text: `Đã ghi nhận (${rating})! Lần ôn kế tiếp: ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(result.next_due_at))}.`,
            });
          }

          return jsonEnvelopeResponse(
            {
              ok: true,
              data: { handled: 'callback_query', review: result },
              request_id: requestId,
            },
            200,
          );
        }

        if (update.message) {
          const msg = update.message;
          if (msg.from?.id !== ownerNumericId) {
            throw new AppError({
              code: 'FORBIDDEN',
              message: 'Message sender is not authorized owner',
              status: 403,
            });
          }
          const text = (msg.text ?? '').trim();
          const chatId = String(msg.chat?.id ?? ownerNumericId);
          const userId = `telegram:${ownerNumericId}`;

          if (text.startsWith('/pause')) {
            await reviewRepo.updateUserPreferences(
              userId,
              requestId,
              `tgcmd_pause_${update.update_id}`,
              { telegram_chat_id: chatId, notifications_enabled: false },
            );
            await botClient.sendMessage({
              chatId,
              text: '⏸ Đã tạm dừng gửi nhắc ôn từ vựng hàng ngày. Gõ /start để bật lại.',
            });
            return jsonEnvelopeResponse(
              { ok: true, data: { handled: 'pause' }, request_id: requestId },
              200,
            );
          }

          if (text.startsWith('/start')) {
            await reviewRepo.updateUserPreferences(
              userId,
              requestId,
              `tgcmd_start_${update.update_id}`,
              { telegram_chat_id: chatId, notifications_enabled: true },
            );
            await botClient.sendMessage({
              chatId,
              text: '👋 Chào mừng bạn! Đã bật thông báo ôn từ vựng lúc 08:00 sáng (UTC+7). Gõ /review để ôn ngay.',
            });
            return jsonEnvelopeResponse(
              { ok: true, data: { handled: 'start' }, request_id: requestId },
              200,
            );
          }

          if (text.startsWith('/review')) {
            const due = await reviewRepo.listDue(userId, requestId, 5);
            const first = due.items[0];
            if (!first) {
              await botClient.sendMessage({
                chatId,
                text: '🎉 Hiện tại không có từ vựng nào đến hạn ôn tập!',
              });
            } else {
              await botClient.sendMessage({
                chatId,
                text: TelegramBotClient.formatDigestMessage(
                  formatLocalDateAsiaHoChiMinh(new Date(nowMs)),
                  due.items,
                ),
                inlineKeyboard: TelegramBotClient.buildQuizKeyboard(
                  first.card_id ?? first.word_id,
                  first.row_version ?? first.version,
                ),
              });
            }
            return jsonEnvelopeResponse(
              {
                ok: true,
                data: { handled: 'review', due_count: due.items.length },
                request_id: requestId,
              },
              200,
            );
          }
        }

        return jsonEnvelopeResponse(
          { ok: true, data: { handled: 'ignored' }, request_id: requestId },
          200,
        );
      });
    }

    // All remaining `/api/v1/*` routes require a verified Bearer session token
    const session = await verifySessionToken({
      authorizationHeader: request.headers.get('authorization'),
      signingSecret: getSigningSecret(env),
      ownerTelegramId: env.OWNER_TELEGRAM_ID,
      nowEpochSeconds: Math.floor(nowMs / 1000),
    });

    // 4. POST /api/v1/live-token (`M2-03`)
    if (request.method === 'POST' && path === '/api/v1/live-token') {
      const rawBody = await parseOptionalRequestJson(request);
      const parsed = liveTokenRequestSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid live-token request payload',
          status: 400,
        });
      }

      securityStore.checkLiveTokenRateLimit(session.userId, nowMs);

      const minted = await mintGeminiEphemeralToken({
        geminiApiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL ?? 'models/gemini-3.8-live',
        nowMs,
        fetchFn,
      });

      return jsonEnvelopeResponse(
        {
          ok: true,
          data: minted,
          request_id: requestId,
        },
        200,
        {
          ...corsHeaders,
          'cache-control': 'no-store',
        },
      );
    }

    // 5. POST /api/v1/vocabulary (`M3-02`)
    if (request.method === 'POST' && path === '/api/v1/vocabulary') {
      const rawJson = await parseRequestJson(request);
      const parsed = vocabularyCreateRequestSchema.safeParse(rawJson);
      if (!parsed.success) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid vocabulary payload',
          status: 400,
        });
      }

      const result = await vocabRepo.upsert(session.userId, requestId, parsed.data);
      return jsonEnvelopeResponse(
        {
          ok: true,
          data: result,
          request_id: requestId,
        },
        200,
        corsHeaders,
      );
    }

    // 6. GET /api/v1/vocabulary (`M3-03`)
    if (request.method === 'GET' && path === '/api/v1/vocabulary') {
      const parsedQuery = vocabularyListQuerySchema.safeParse({
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
        search: url.searchParams.get('search') ?? undefined,
      });
      if (!parsedQuery.success) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid pagination or search query parameters',
          status: 400,
        });
      }

      const result = await vocabRepo.list(session.userId, requestId, parsedQuery.data);
      return jsonEnvelopeResponse(
        {
          ok: true,
          data: result,
          request_id: requestId,
        },
        200,
        corsHeaders,
      );
    }

    // 7. PATCH & DELETE /api/v1/vocabulary/:id (`M3-03`)
    if (path.startsWith('/api/v1/vocabulary/')) {
      const wordId = decodeURIComponent(path.slice('/api/v1/vocabulary/'.length)).trim();
      if (!wordId || wordId.length > 120) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid word_id parameter',
          status: 400,
        });
      }

      if (request.method === 'PATCH') {
        const rawJson = await parseRequestJson(request);
        const parsed = vocabularyUpdateRequestSchema.safeParse(rawJson);
        if (!parsed.success) {
          throw new AppError({
            code: 'INVALID_ARGUMENT',
            message: 'Invalid vocabulary update payload',
            status: 400,
          });
        }
        const updated = await vocabRepo.update(session.userId, requestId, wordId, parsed.data);
        return jsonEnvelopeResponse(
          {
            ok: true,
            data: updated,
            request_id: requestId,
          },
          200,
          corsHeaders,
        );
      }

      if (request.method === 'DELETE') {
        const eventId = url.searchParams.get('event_id')?.trim() || `del_${requestId.slice(0, 48)}`;
        const deleted = await vocabRepo.softDelete(session.userId, requestId, wordId, eventId);
        return jsonEnvelopeResponse(
          {
            ok: true,
            data: deleted,
            request_id: requestId,
          },
          200,
          corsHeaders,
        );
      }
    }

    // 8. GET /api/v1/reviews/due & GET /api/reviews/due (`M4`)
    if (
      request.method === 'GET' &&
      (path === '/api/v1/reviews/due' || path === '/api/reviews/due')
    ) {
      const rawLimit = Number(url.searchParams.get('limit') ?? '10');
      const limit = Number.isInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 10;
      const due = await reviewRepo.listDue(session.userId, requestId, limit);
      return jsonEnvelopeResponse(
        {
          ok: true,
          data: due,
          request_id: requestId,
        },
        200,
        corsHeaders,
      );
    }

    // 8b. GET /api/v1/reviews/:cardId/preview & GET /api/reviews/:cardId/preview (`M4-FSRS`)
    if (
      request.method === 'GET' &&
      ((path.startsWith('/api/reviews/') && path.endsWith('/preview')) ||
        (path.startsWith('/api/v1/reviews/') && path.endsWith('/preview')))
    ) {
      const prefix = path.startsWith('/api/v1/reviews/') ? '/api/v1/reviews/' : '/api/reviews/';
      const cardId = decodeURIComponent(path.slice(prefix.length, -'/preview'.length)).trim();
      if (!cardId || cardId.length > 120) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid cardId parameter',
          status: 400,
        });
      }
      const preview = await reviewRepo.preview(
        session.userId,
        requestId,
        cardId,
        new Date(nowMs).toISOString(),
      );
      return jsonEnvelopeResponse(
        {
          ok: true,
          data: preview,
          request_id: requestId,
        },
        200,
        corsHeaders,
      );
    }

    // 8c. GET /api/v1/reviews/stats & GET /api/reviews/stats (`M4-FSRS`)
    if (
      request.method === 'GET' &&
      (path === '/api/v1/reviews/stats' || path === '/api/reviews/stats')
    ) {
      const stats = await reviewRepo.getStats(
        session.userId,
        requestId,
        new Date(nowMs).toISOString(),
      );
      return jsonEnvelopeResponse(
        {
          ok: true,
          data: stats,
          request_id: requestId,
        },
        200,
        corsHeaders,
      );
    }

    // 9. POST /api/v1/reviews, POST /api/v1/reviews/submit & POST /api/reviews/submit (`M4`)
    if (
      request.method === 'POST' &&
      (path === '/api/v1/reviews' ||
        path === '/api/v1/reviews/submit' ||
        path === '/api/reviews/submit')
    ) {
      const rawJson = await parseRequestJson(request);
      const parsed = reviewSubmitRequestSchema.safeParse(rawJson);
      if (!parsed.success) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid review submission payload',
          status: 400,
        });
      }

      const reviewedAtIso = new Date(nowMs).toISOString();
      const recorded = await reviewRepo.recordReview(
        session.userId,
        requestId,
        parsed.data,
        reviewedAtIso,
      );
      return jsonEnvelopeResponse(
        {
          ok: true,
          data: recorded,
          request_id: requestId,
        },
        200,
        corsHeaders,
      );
    }

    throw new AppError({
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${path} not found`,
      status: 404,
    });
  } catch (err) {
    if (err instanceof AppError) {
      logStructured('warn', 'api_error', requestId, {
        path,
        code: err.code,
        status: err.status,
      });
      return jsonEnvelopeResponse(
        {
          ok: false,
          error: {
            code: err.code,
            message: err.message,
            retryable: err.retryable,
          },
          request_id: requestId,
        },
        err.status,
        corsHeaders,
      );
    }

    logStructured('error', 'unhandled_worker_exception', requestId, {
      path,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return jsonEnvelopeResponse(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected internal error occurred',
          retryable: false,
        },
        request_id: requestId,
      },
      500,
      corsHeaders,
    );
  }
}

/**
 * Scheduled Cron handler running at `01:00 UTC` (`08:00 Asia/Ho_Chi_Minh`, `M2-04`, `M4-03`).
 * Claims a daily digest idempotently in `DailyDispatchLog` and sends at most 1 reminder per local day.
 */
export async function handleScheduledCron(
  scheduledTimeMs: number,
  env: WorkerEnv,
  deps: WorkerDependencies = {},
): Promise<{
  dispatched: boolean;
  reason: string;
  localDate: string;
  dueCount: number;
}> {
  const requestId = `cron_${scheduledTimeMs}`;
  const localDate = formatLocalDateAsiaHoChiMinh(new Date(scheduledTimeMs));
  const fetchFn = deps.fetchFn ?? fetch;
  const gasAdapter = new GasRepositoryAdapter(env.GAS_EXEC_URL, env.GAS_SHARED_SECRET, fetchFn);
  const reviewRepo = deps.reviewRepo ?? gasAdapter;
  const userId = `telegram:${env.OWNER_TELEGRAM_ID.trim()}`;

  const claim = await reviewRepo.claimDailyDigest(
    userId,
    requestId,
    localDate,
    10,
    new Date(scheduledTimeMs).toISOString(),
  );
  if (claim.already_dispatched) {
    return {
      dispatched: false,
      reason: 'already_dispatched',
      localDate,
      dueCount: claim.due_cards.length,
    };
  }

  if (!claim.notifications_enabled) {
    return {
      dispatched: false,
      reason: 'notifications_disabled',
      localDate,
      dueCount: 0,
    };
  }

  if (claim.due_cards.length === 0) {
    return {
      dispatched: false,
      reason: 'no_due_words',
      localDate,
      dueCount: 0,
    };
  }

  const botClient = new TelegramBotClient(env.TELEGRAM_BOT_TOKEN, fetchFn);
  const firstCard = claim.due_cards[0]!;
  if (!claim.claim_token)
    throw new AppError({
      code: 'UPSTREAM_ERROR',
      message: 'Missing digest claim token',
      status: 502,
    });
  const chatId = claim.telegram_chat_id || env.OWNER_TELEGRAM_ID.trim();
  const sendResult = await botClient.sendMessage({
    chatId,
    text: TelegramBotClient.formatDigestMessage(localDate, claim.due_cards),
    inlineKeyboard: TelegramBotClient.buildQuizKeyboard(
      firstCard.card_id ?? firstCard.word_id,
      firstCard.row_version ?? firstCard.version,
    ),
  });

  await reviewRepo.finishDailyDigest(userId, requestId, {
    dispatch_id: claim.dispatch_id,
    claim_token: claim.claim_token,
    status: sendResult.ok ? 'sent' : sendResult.outcome === 'unknown' ? 'unknown' : 'failed',
    ...(sendResult.messageId !== undefined ? { message_id: sendResult.messageId } : {}),
  });

  return {
    dispatched: sendResult.ok,
    reason: sendResult.ok ? 'sent' : 'telegram_send_failed',
    localDate,
    dueCount: claim.due_cards.length,
  };
}

async function parseRequestJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text || text.length > 16384) {
    throw new AppError({
      code: 'INVALID_ARGUMENT',
      message: 'Request body is empty or exceeds maximum size',
      status: 400,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError({
      code: 'INVALID_ARGUMENT',
      message: 'Malformed JSON body',
      status: 400,
    });
  }
}

async function parseOptionalRequestJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) {
    return undefined;
  }
  if (text.length > 4096) {
    throw new AppError({
      code: 'INVALID_ARGUMENT',
      message: 'Request body exceeds maximum size',
      status: 400,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError({
      code: 'INVALID_ARGUMENT',
      message: 'Malformed JSON body',
      status: 400,
    });
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
  async scheduled(controller: { scheduledTime: number }, env: WorkerEnv): Promise<void> {
    await handleScheduledCron(controller.scheduledTime, env);
  },
};
