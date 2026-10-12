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

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status = 0,
  ) {
    super(message);
  }
}

/** Keeps the verified session in memory; never stores initData or tokens in browser storage. */
export class LearningApiClient {
  private session: TelegramAuthResponse | null = null;
  private authenticating: Promise<TelegramAuthResponse> | null = null;
  public constructor(
    private readonly baseUrl: string,
    private readonly getInitData: () => string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  public async authenticate(): Promise<TelegramAuthResponse> {
    if (this.session && Date.parse(this.session.expires_at) > Date.now() + 30000)
      return this.session;
    if (this.authenticating) return this.authenticating;
    const initData = this.getInitData();
    if (!initData)
      throw new ApiClientError('Hãy mở ứng dụng từ Telegram Mini App để đăng nhập.', false, 401);
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
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
        cache: 'no-store',
      });
    } catch {
      throw new ApiClientError('Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.', true);
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ApiClientError('Máy chủ trả về dữ liệu không hợp lệ.', false, response.status);
    }
    const envelope = z
      .discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), data: z.unknown(), request_id: z.string() }),
        z.object({ ok: z.literal(false), error: apiErrorDetailSchema, request_id: z.string() }),
      ])
      .safeParse(raw);
    if (!envelope.success)
      throw new ApiClientError('Response không đúng hợp đồng API.', false, response.status);
    if (!envelope.data.ok)
      throw new ApiClientError(
        envelope.data.error.message,
        envelope.data.error.retryable,
        response.status,
      );
    if (!response.ok)
      throw new ApiClientError('Yêu cầu API thất bại.', response.status >= 500, response.status);
    const validated = schema.safeParse(envelope.data.data);
    if (!validated.success)
      throw new ApiClientError('Dữ liệu trả về không đúng schema.', false, response.status);
    return validated.data;
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
