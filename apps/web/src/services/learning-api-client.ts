import { z } from 'zod';
import {
  apiErrorDetailSchema,
  dueReviewCardSchema,
  liveTokenResponseSchema,
  reviewPreviewResponseSchema,
  reviewStatsResponseSchema,
  reviewSubmitResponseSchema,
  telegramAuthResponseSchema,
  vocabularyCreateResponseSchema,
  vocabularyItemSchema,
  vocabularyListResponseSchema,
  type LiveTokenResponse,
  type DueReviewCard,
  type ReviewPreviewResponse,
  type ReviewStatsResponse,
  type ReviewSubmitRequest,
  type ReviewSubmitResponse,
  type TelegramAuthResponse,
  type VocabularyCreateRequest,
  type VocabularyCreateResponse,
  type VocabularyItem,
  type VocabularyUpdateRequest,
  type VocabularyListResponse,
} from '@voice-chat/shared';
import {
  ApiDiagnostics,
  createDiagnosticRequestId,
  safeExceptionName,
  safeServerRequestId,
  type ApiDiagnostic,
  type DiagnosticCode,
  type DiagnosticPhase,
  type ExceptionName,
} from './api-diagnostics.js';

interface RequestTrace {
  phase: DiagnosticPhase;
  status: number | null;
  serverRequestId: string | null;
}

export class ApiClientError extends Error {
  public diagnostic: ApiDiagnostic | undefined;
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status = 0,
    public readonly code: DiagnosticCode = 'CLIENT_ERROR',
    public readonly exceptionName: ExceptionName | null = null,
  ) {
    super(message);
  }
}

/** Keeps the verified session in memory; never stores initData or tokens in browser storage. */
export class LearningApiClient {
  public readonly diagnostics: ApiDiagnostics;
  private session: TelegramAuthResponse | null = null;
  private authenticating: Promise<TelegramAuthResponse> | null = null;
  public constructor(
    private readonly baseUrl: string,
    private readonly getInitData: () => string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.diagnostics = new ApiDiagnostics(baseUrl);
  }

  public async authenticate(): Promise<TelegramAuthResponse> {
    if (this.session && Date.parse(this.session.expires_at) > Date.now() + 30000)
      return this.session;
    if (this.authenticating) return this.authenticating;
    const initData = this.getInitData();
    if (!initData) {
      const error = new ApiClientError(
        'Hãy mở ứng dụng từ Telegram Mini App để đăng nhập.',
        false,
        401,
        'MISSING_INIT_DATA',
      );
      error.diagnostic = this.diagnostics.record({
        request_id: createDiagnosticRequestId(),
        server_request_id: null,
        method: 'POST',
        route: '/api/v1/auth/telegram',
        code: error.code,
        phase: 'local',
        http_status: null,
        duration_ms: 0,
        exception_name: null,
      });
      throw error;
    }
    this.authenticating = this.send('/api/v1/auth/telegram', 'POST', telegramAuthResponseSchema, {
      init_data: initData,
    })
      .then((session) => {
        this.session = session;
        return session;
      })
      .finally(() => {
        this.authenticating = null;
      });
    return this.authenticating;
  }

  private async send<T>(
    path: string,
    method: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body?: unknown,
    token?: string,
  ): Promise<T> {
    const requestId = createDiagnosticRequestId();
    const started = Date.now();
    const trace: RequestTrace = { phase: 'configuration', status: null, serverRequestId: null };
    const record = (code: DiagnosticCode, exceptionName: ExceptionName | null) =>
      this.diagnostics.record({
        request_id: requestId,
        server_request_id: trace.serverRequestId,
        method,
        route: path,
        code,
        phase: trace.phase,
        http_status: trace.status,
        duration_ms: Date.now() - started,
        exception_name: exceptionName,
      });
    try {
      const url = this.resolveRequestUrl(path);
      // A simple GET probe omits custom headers to test reachability separately from auth preflight.
      const headers =
        path === '/health'
          ? {}
          : {
              'content-type': 'application/json',
              'x-request-id': requestId,
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            };
      const { response, raw } = await this.fetchJson(
        url,
        {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          cache: 'no-store',
        },
        trace,
      );
      trace.phase = 'envelope';
      const envelope = z
        .discriminatedUnion('ok', [
          z.object({ ok: z.literal(true), data: z.unknown(), request_id: z.string() }),
          z.object({ ok: z.literal(false), error: apiErrorDetailSchema, request_id: z.string() }),
        ])
        .safeParse(raw);
      if (!envelope.success)
        throw new ApiClientError(
          'Response không đúng hợp đồng API.',
          false,
          response.status,
          'INVALID_ENVELOPE',
        );
      trace.serverRequestId = safeServerRequestId(envelope.data.request_id);
      trace.phase = 'api';
      if (!envelope.data.ok)
        throw new ApiClientError(
          envelope.data.error.message,
          envelope.data.error.retryable,
          response.status,
          envelope.data.error.code,
        );
      if (!response.ok)
        throw new ApiClientError(
          'Yêu cầu API thất bại.',
          response.status >= 500,
          response.status,
          'HTTP_ERROR',
        );
      trace.phase = 'schema';
      const validated = schema.safeParse(envelope.data.data);
      if (!validated.success)
        throw new ApiClientError(
          'Dữ liệu trả về không đúng schema.',
          false,
          response.status,
          'INVALID_DATA',
        );
      trace.phase = 'complete';
      record('OK', null);
      return validated.data;
    } catch (failure) {
      const error =
        failure instanceof ApiClientError
          ? failure
          : new ApiClientError(
              'Không thể thực hiện yêu cầu. Hãy thử lại.',
              false,
              trace.status ?? 0,
              'CLIENT_ERROR',
              safeExceptionName(failure),
            );
      error.diagnostic = record(error.code, error.exceptionName);
      throw error;
    }
  }

  /** Checks Worker reachability only; does not authenticate or check Sheets/Gemini. */
  public checkConnection(): Promise<{
    status: 'healthy';
    service: 'voice-chat-worker';
    version: string;
    timestamp: string;
  }> {
    return this.send(
      '/health',
      'GET',
      z.object({
        status: z.literal('healthy'),
        service: z.literal('voice-chat-worker'),
        version: z.string(),
        timestamp: z.string().datetime(),
      }),
    );
  }

  private resolveRequestUrl(path: string): string {
    const base = this.baseUrl.trim().replace(/\/+$/, '');
    // Empty base supports deployments routing the API on the Mini App's own origin.
    if (!base) return path;
    const invalidConfig = () =>
      new ApiClientError(
        'Cấu hình kết nối máy chủ chưa đúng. Hãy liên hệ người quản trị.',
        false,
        0,
        'INVALID_CONFIG',
      );
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw invalidConfig();
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.hostname.toLowerCase().includes('your-worker') ||
      (globalThis.location?.protocol === 'https:' && url.protocol !== 'https:')
    )
      throw invalidConfig();
    return `${url.toString().replace(/\/+$/, '')}${path}`;
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    trace: RequestTrace,
  ): Promise<{ response: Response; raw: unknown }> {
    // Older Telegram WebViews lack AbortSignal.timeout; abort explicitly instead.
    const controller = new AbortController();
    let timedOut = false;
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    const connectionError = (failure: unknown) =>
      new ApiClientError(
        timedOut
          ? 'Máy chủ phản hồi quá chậm. Hãy thử lại.'
          : 'Không thể kết nối máy chủ. Hãy thử lại sau hoặc liên hệ người quản trị.',
        true,
        trace.status ?? 0,
        timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        safeExceptionName(failure),
      );
    try {
      let response: Response;
      trace.phase = 'fetch';
      try {
        // Window.fetch rejects a client instance as receiver ("Illegal invocation") in WebViews.
        response = await this.fetchFn.call(globalThis, url, { ...init, signal: controller.signal });
      } catch (failure) {
        throw connectionError(failure);
      }
      trace.status = response.status;
      trace.phase = 'json';
      try {
        return { response, raw: (await response.json()) as unknown };
      } catch (failure) {
        if (timedOut) throw connectionError(failure);
        if (safeExceptionName(failure) !== 'SyntaxError')
          throw new ApiClientError(
            'Không thể đọc phản hồi máy chủ. Hãy thử lại.',
            true,
            response.status,
            'RESPONSE_READ_ERROR',
            safeExceptionName(failure),
          );
        throw new ApiClientError(
          'Máy chủ trả về dữ liệu không hợp lệ.',
          false,
          response.status,
          'INVALID_JSON',
          safeExceptionName(failure),
        );
      }
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  private async authorized<T>(
    path: string,
    method: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body?: unknown,
  ): Promise<T> {
    const session = await this.authenticate();
    try {
      return await this.send(path, method, schema, body, session.session_token);
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.status !== 401) throw error;
      this.session = null;
      const refreshed = await this.authenticate();
      return this.send(path, method, schema, body, refreshed.session_token);
    }
  }
  public async listVocabulary(): Promise<VocabularyItem[]> {
    const items: VocabularyItem[] = [];
    let cursor: string | null = null;
    const visited = new Set<string>();
    do {
      const page: VocabularyListResponse = await this.authorized(
        `/api/v1/vocabulary?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        'GET',
        vocabularyListResponseSchema,
      );
      items.push(...page.items);
      cursor = page.next_cursor;
      if (cursor) {
        if (visited.has(cursor) || visited.size >= 200)
          throw new ApiClientError('Phân trang dữ liệu không hợp lệ.', false);
        visited.add(cursor);
      }
    } while (cursor);
    return items;
  }
  public createVocabulary(input: VocabularyCreateRequest): Promise<VocabularyCreateResponse> {
    return this.authorized('/api/v1/vocabulary', 'POST', vocabularyCreateResponseSchema, input);
  }
  public updateVocabulary(wordId: string, input: VocabularyUpdateRequest): Promise<VocabularyItem> {
    return this.authorized(
      `/api/v1/vocabulary/${encodeURIComponent(wordId)}`,
      'PATCH',
      vocabularyItemSchema,
      input,
    );
  }
  public deleteVocabulary(
    wordId: string,
    eventId: string,
  ): Promise<{ word_id: string; deleted: boolean }> {
    return this.authorized(
      `/api/v1/vocabulary/${encodeURIComponent(wordId)}?event_id=${encodeURIComponent(eventId)}`,
      'DELETE',
      z.object({ word_id: z.string(), deleted: z.boolean() }),
    );
  }
  public submitReview(input: ReviewSubmitRequest): Promise<ReviewSubmitResponse> {
    return this.authorized('/api/v1/reviews/submit', 'POST', reviewSubmitResponseSchema, input);
  }
  public async listDueReviews(): Promise<DueReviewCard[]> {
    return (
      await this.authorized(
        '/api/v1/reviews/due?limit=50',
        'GET',
        z.object({ items: z.array(dueReviewCardSchema) }),
      )
    ).items;
  }
  public previewReview(cardId: string): Promise<ReviewPreviewResponse> {
    return this.authorized(
      `/api/v1/reviews/${encodeURIComponent(cardId)}/preview`,
      'GET',
      reviewPreviewResponseSchema,
    );
  }
  public getReviewStats(): Promise<ReviewStatsResponse> {
    return this.authorized('/api/v1/reviews/stats', 'GET', reviewStatsResponseSchema);
  }
  public mintLiveToken(): Promise<LiveTokenResponse> {
    return this.authorized('/api/v1/live-token', 'POST', liveTokenResponseSchema, {
      session_purpose: 'voice_chat',
    });
  }
}
