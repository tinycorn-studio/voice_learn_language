import {
  formatLocalDateAsiaHoChiMinh,
  liveTokenRequestSchema,
  reviewSubmitRequestSchema,
  telegramAuthRequestSchema,
  telegramUpdateSchema,
  translationRequestSchema,
  vocabularyCreateRequestSchema,
  vocabularyListQuerySchema,
  vocabularyUpdateRequestSchema,
  type ReviewRating,
} from '@voice-chat/shared';
import { createRepositories } from './adapters/repository-factory.js';
import { mintGeminiEphemeralToken } from './adapters/gemini-token-issuer.js';
import { translateTranscriptTurn } from './adapters/gemini-translator.js';
import { TelegramBotClient } from './adapters/telegram-bot-client.js';
import { processSheetMirror } from './adapters/sheet-mirror.js';
import {
  formatReviewResult,
  processTelegramDeliveries,
} from './adapters/telegram-delivery-store.js';
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
  private readonly translationHits = new Map<string, number[]>();
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

  /** Limits on-demand translation bursts per authenticated user and Worker isolate. */
  public checkTranslationRateLimit(userId: string, nowMs: number, maxPerMinute = 12): void {
    const windowStart = nowMs - 60_000;
    const history = (this.translationHits.get(userId) ?? []).filter((ts) => ts > windowStart);
    if (history.length >= maxPerMinute) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Bạn đã dịch nhiều câu trong thời gian ngắn. Hãy chờ một chút rồi thử lại.',
        status: 429,
        retryable: true,
      });
    }
    history.push(nowMs);
    this.translationHits.set(userId, history);
    if (this.translationHits.size > 1000) {
      const oldest = this.translationHits.keys().next().value;
      if (oldest !== undefined) this.translationHits.delete(oldest);
    }
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

export interface ClientLogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  details?: unknown;
  userAgent?: string | undefined;
  clientIp?: string | undefined;
}

const clientLogsRingBuffer: ClientLogEntry[] = [];
function addClientLog(entry: Omit<ClientLogEntry, 'id'>): void {
  const item: ClientLogEntry = { id: crypto.randomUUID(), ...entry };
  clientLogsRingBuffer.unshift(item);
  if (clientLogsRingBuffer.length > 100) {
    clientLogsRingBuffer.pop();
  }
}

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
  const started = performance.now();
  const response = await handleWorkerRequestInternal(request, env, deps, securityStore);
  const path = new URL(request.url).pathname;
  const route = diagnosticRouteForPath(path);
  logStructured('info', 'api_request_complete', response.headers.get('x-request-id') ?? 'unknown', {
    route,
    http_status: response.status,
    duration_ms: Math.max(0, Math.round(performance.now() - started)),
  });
  return response;
}

function diagnosticRouteForPath(path: string): string {
  if (path.startsWith('/api/v1/vocabulary/')) return '/api/v1/vocabulary/:id';
  if (/^\/api\/v1\/reviews\/[^/]+\/preview$/.test(path)) return '/api/v1/reviews/:id/preview';
  return [
    '/health',
    '/telegram/webhook',
    '/api/v1/auth/telegram',
    '/api/v1/vocabulary',
    '/api/v1/live-token',
    '/api/v1/translate',
    '/api/v1/reviews',
    '/api/v1/reviews/due',
    '/api/v1/reviews/submit',
    '/api/v1/reviews/stats',
  ].includes(path)
    ? path
    : 'other';
}

async function handleWorkerRequestInternal(
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

  const resolveRepositories = async () => {
    if (deps.vocabRepo && deps.reviewRepo)
      return { vocabulary: deps.vocabRepo, review: deps.reviewRepo };
    const selected = await createRepositories(env, fetchFn);
    return {
      vocabulary: deps.vocabRepo ?? selected.vocabulary,
      review: deps.reviewRepo ?? selected.review,
    };
  };

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

    // 1b. POST /api/v1/client-logs — Ingest diagnostic logs from webview/mini-app
    if (request.method === 'POST' && path === '/api/v1/client-logs') {
      const rawJson = await parseOptionalRequestJson(request);
      const data =
        typeof rawJson === 'object' && rawJson !== null ? (rawJson as Record<string, unknown>) : {};
      const logEntry = {
        timestamp:
          typeof data.timestamp === 'string' ? data.timestamp : new Date(nowMs).toISOString(),
        level: typeof data.level === 'string' ? data.level : 'info',
        message: typeof data.message === 'string' ? data.message.slice(0, 1000) : 'client event',
        details: data.details,
        userAgent: request.headers.get('user-agent')?.slice(0, 300) || undefined,
        clientIp: request.headers.get('cf-connecting-ip') || undefined,
      };
      addClientLog(logEntry);
      logStructured('info', 'client_diagnostic_log', requestId, {
        client_level: ['info', 'warn', 'error'].includes(logEntry.level) ? logEntry.level : 'info',
      });
      return jsonEnvelopeResponse(
        { ok: true, data: { received: true }, request_id: requestId },
        200,
        corsHeaders,
      );
    }

    // 1c. GET /api/v1/client-logs — Retrieve captured client diagnostic logs
    if (request.method === 'GET' && path === '/api/v1/client-logs') {
      return jsonEnvelopeResponse(
        { ok: true, data: { logs: clientLogsRingBuffer }, request_id: requestId },
        200,
        corsHeaders,
      );
    }

    // 1d. GET /api/v1/diag — Probe system dependencies (Worker, GAS, Gemini configuration)
    if (request.method === 'GET' && path === '/api/v1/diag') {
      let gasStatus = 'not_configured';
      let gasLatencyMs = 0;
      if (env.GAS_EXEC_URL) {
        try {
          const gasStart = Date.now();
          const gasRes = await fetchFn.call(globalThis, env.GAS_EXEC_URL, {
            method: 'GET',
            redirect: 'follow',
          });
          gasLatencyMs = Date.now() - gasStart;
          gasStatus = gasRes.ok ? 'connected' : `http_${gasRes.status}`;
        } catch (e) {
          gasStatus = e instanceof Error ? e.message : 'failed';
        }
      }

      return jsonEnvelopeResponse(
        {
          ok: true,
          data: {
            worker_status: 'healthy',
            timestamp: new Date(nowMs).toISOString(),
            gemini_configured: Boolean(env.GEMINI_API_KEY),
            telegram_configured: Boolean(env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_ID),
            gas_configured: Boolean(env.GAS_EXEC_URL && env.GAS_SHARED_SECRET),
            gas_status: gasStatus,
            gas_latency_ms: gasLatencyMs,
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
      const { review: reviewRepo } = await resolveRepositories();
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
          const ackStarted = performance.now();
          const acknowledged = await botClient
            .answerCallbackQuery({
              callbackQueryId: cb.id,
              text: 'Đang ghi nhận…',
              timeoutMs: 1000,
            })
            .catch(() => false);
          logStructured('info', 'telegram_callback_ack', requestId, {
            acknowledged,
            duration_ms: Math.round(performance.now() - ackStarted),
          });
          const commitStarted = performance.now();
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
            ...(env.DATA_BACKEND === 'd1'
              ? [
                  {
                    updateId: update.update_id,
                    chatId: String(cb.message?.chat.id ?? cb.from.id),
                    ...(cb.message?.message_id ? { messageId: cb.message.message_id } : {}),
                  },
                ]
              : []),
          );
          logStructured('info', 'telegram_review_committed', requestId, {
            duration_ms: Math.round(performance.now() - commitStarted),
            callback_acknowledged: acknowledged,
          });

          if (cb.id && env.DATA_BACKEND !== 'd1') {
            const text = formatReviewResult(rating, result.next_due_at);
            const delivered = await (
              cb.message?.message_id
                ? botClient.editReviewResult(cb.message.chat.id, cb.message.message_id, text)
                : botClient.answerCallbackQuery({ callbackQueryId: cb.id, text, timeoutMs: 1000 })
            ).catch(() => false);
            if (!delivered) logStructured('warn', 'telegram_result_delivery_failed', requestId);
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
            const confirmation =
              '⏸ Đã tạm dừng gửi nhắc ôn từ vựng hàng ngày. Gõ /start để bật lại.';
            await reviewRepo.updateUserPreferences(
              userId,
              requestId,
              `tgcmd_pause_${update.update_id}`,
              { telegram_chat_id: chatId, notifications_enabled: false },
              ...(env.DATA_BACKEND === 'd1'
                ? [{ updateId: update.update_id, chatId, confirmationText: confirmation }]
                : []),
            );
            if (env.DATA_BACKEND !== 'd1')
              await botClient.sendMessage({
                chatId,
                text: confirmation,
              });
            return jsonEnvelopeResponse(
              { ok: true, data: { handled: 'pause' }, request_id: requestId },
              200,
            );
          }

          if (text.startsWith('/start')) {
            const confirmation =
              '👋 Chào mừng bạn! Đã bật thông báo ôn từ vựng lúc 08:00 sáng (UTC+7). Gõ /review để ôn ngay.';
            await reviewRepo.updateUserPreferences(
              userId,
              requestId,
              `tgcmd_start_${update.update_id}`,
              { telegram_chat_id: chatId, notifications_enabled: true },
              ...(env.DATA_BACKEND === 'd1'
                ? [{ updateId: update.update_id, chatId, confirmationText: confirmation }]
                : []),
            );
            if (env.DATA_BACKEND !== 'd1')
              await botClient.sendMessage({
                chatId,
                text: confirmation,
              });
            return jsonEnvelopeResponse(
              { ok: true, data: { handled: 'start' }, request_id: requestId },
              200,
            );
          }

          if (text.startsWith('/review')) {
            const due = await reviewRepo.listDue(userId, requestId, 5);
            const first = due.items[0];
            if (env.DATA_BACKEND === 'd1' && reviewRepo.acceptTelegramCommand) {
              await reviewRepo.acceptTelegramCommand(userId, requestId, update.update_id, chatId, {
                kind: 'send',
                text: first
                  ? TelegramBotClient.formatDigestMessage(
                      formatLocalDateAsiaHoChiMinh(new Date(nowMs)),
                      due.items,
                    )
                  : '🎉 Hiện tại không có từ vựng nào đến hạn ôn tập!',
                ...(first
                  ? {
                      inline_keyboard: TelegramBotClient.buildQuizKeyboard(
                        first.card_id ?? first.word_id,
                        first.row_version ?? first.version,
                      ),
                    }
                  : {}),
              });
            } else if (!first) {
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

    // Translate only the sentence explicitly selected by the authenticated learner.
    if (request.method === 'POST' && path === '/api/v1/translate') {
      const rawJson = await parseRequestJson(request);
      const parsed = translationRequestSchema.safeParse(rawJson);
      if (!parsed.success) {
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid translation request payload',
          status: 400,
        });
      }
      securityStore.checkTranslationRateLimit(session.userId, nowMs);
      const translation = await translateTranscriptTurn({
        text: parsed.data.text,
        geminiApiKey: env.GEMINI_API_KEY,
        ...(env.GEMINI_TRANSLATION_MODEL ? { model: env.GEMINI_TRANSLATION_MODEL } : {}),
        fetchFn,
      });
      return jsonEnvelopeResponse(
        { ok: true, data: { translation }, request_id: requestId },
        200,
        { ...corsHeaders, 'cache-control': 'no-store' },
      );
    }

    const { vocabulary: vocabRepo, review: reviewRepo } = await resolveRepositories();
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
        route: diagnosticRouteForPath(path),
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
      route: diagnosticRouteForPath(path),
      exception_name: err instanceof Error ? err.name : 'Other',
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
  const reviewRepo = deps.reviewRepo ?? (await createRepositories(env, fetchFn)).review;
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

/** Minute tick drains durable work; daily digest stays within its UTC+7 morning window. */
export async function handleScheduledTick(
  scheduledTime: number,
  env: WorkerEnv,
  deps: WorkerDependencies = {},
): Promise<void> {
  if (env.DATA_BACKEND === 'd1' && env.DB) {
    const now = new Date(scheduledTime).toISOString();
    const fetchFn = deps.fetchFn ?? fetch;
    const outcomes = await Promise.allSettled([
      processTelegramDeliveries(
        env.DB,
        new TelegramBotClient(env.TELEGRAM_BOT_TOKEN, fetchFn),
        now,
        1,
      ),
      processSheetMirror(env.DB, env, now, fetchFn),
    ]);
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected')
        logStructured('warn', 'background_job_deferred', `cron_${scheduledTime}`, {
          processor: index === 0 ? 'telegram' : 'sheet_mirror',
        });
    });
    const time = new Date(scheduledTime);
    if (time.getUTCHours() !== 1 || time.getUTCMinutes() > 5) return;
  }
  await handleScheduledCron(scheduledTime, env, deps);
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: { waitUntil(work: Promise<unknown>): void },
  ): Promise<Response> {
    const response = await handleWorkerRequest(request, env);
    const path = new URL(request.url).pathname;
    if (
      ctx &&
      env.DATA_BACKEND === 'd1' &&
      env.DB &&
      request.method === 'POST' &&
      new URL(request.url).pathname === '/telegram/webhook' &&
      response.ok
    ) {
      ctx.waitUntil(
        processTelegramDeliveries(
          env.DB,
          new TelegramBotClient(env.TELEGRAM_BOT_TOKEN),
          new Date().toISOString(),
          3,
        ).catch(() => logStructured('warn', 'telegram_delivery_deferred', 'background')),
      );
    }
    if (
      ctx &&
      env.DATA_BACKEND === 'd1' &&
      env.DB &&
      response.ok &&
      ['POST', 'PATCH', 'DELETE'].includes(request.method) &&
      (path === '/telegram/webhook' ||
        path === '/api/v1/vocabulary' ||
        path.startsWith('/api/v1/vocabulary/') ||
        ['/api/v1/reviews', '/api/v1/reviews/submit', '/api/reviews/submit'].includes(path))
    ) {
      // Schedule interactive Telegram result delivery before the lower-priority Sheet mirror.
      // Both jobs are durable; the minute Cron recovers them if this foreground kick is lost.
      ctx.waitUntil(
        processSheetMirror(env.DB, env, new Date().toISOString()).catch(() =>
          logStructured('warn', 'sheet_mirror_deferred', 'background'),
        ),
      );
    }
    return response;
  },
  async scheduled(controller: { scheduledTime: number }, env: WorkerEnv): Promise<void> {
    await handleScheduledTick(controller.scheduledTime, env);
  },
};
