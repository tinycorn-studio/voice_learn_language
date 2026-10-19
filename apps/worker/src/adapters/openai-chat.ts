import { z } from 'zod';
import { AppError } from '../domain/env.js';

/**
 * Minimal OpenAI-compatible `/chat/completions` client (`M9-05`).
 * Works with any provider exposing this standard (Z.AI GLM, DeepSeek, ...); the endpoint,
 * model, and key are operator configuration and never come from learner input.
 */
const MAX_PROVIDER_WAIT_MS = 8_000;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const BASE_URL_PATTERN = /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?(?:\/[a-z0-9_-]+)*$/i;

export interface OpenAiChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const chatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().nullable().optional() }),
      finish_reason: z.string().optional(),
    }),
  ),
});

/**
 * Validates operator-provided endpoint configuration. Returns `null` when incomplete or unsafe
 * (non-HTTPS, credentials, query/hash, oversized or malformed model) so callers can fall back.
 */
export function resolveOpenAiChatConfig(raw: {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  model?: string | undefined;
}): OpenAiChatConfig | null {
  const baseUrl = (raw.baseUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = (raw.apiKey ?? '').trim();
  const model = (raw.model ?? '').trim();
  if (!apiKey || !MODEL_PATTERN.test(model) || !BASE_URL_PATTERN.test(baseUrl)) {
    return null;
  }
  return { baseUrl, apiKey, model };
}

/**
 * Sends one bounded chat completion and returns the sanitized assistant text.
 * Learner content is sent only for this request; raw provider payloads never leave this function.
 */
export async function requestOpenAiCompatibleChat(params: {
  config: OpenAiChatConfig;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  maxContentLength: number;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const fetchFn = params.fetchFn ?? fetch;

  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAX_PROVIDER_WAIT_MS);

  let response: Response;
  let providerPayload: unknown;
  try {
    response = await fetchFn.call(globalThis, `${params.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${params.config.apiKey}`,
      },
      body: JSON.stringify({
        model: params.config.model,
        messages: [{ role: 'system', content: params.system }, ...params.messages],
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    providerPayload = await response.json().catch(() => null);
  } catch {
    if (timedOut) {
      throw new AppError({
        code: 'TIMEOUT',
        message: 'Dịch vụ AI phản hồi quá chậm. Hãy thử lại.',
        status: 504,
        retryable: true,
      });
    }
    throw new AppError({
      code: 'UNAVAILABLE',
      message: 'Không thể kết nối dịch vụ AI. Hãy thử lại.',
      status: 503,
      retryable: true,
    });
  } finally {
    globalThis.clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new AppError({
      code: 'RATE_LIMITED',
      message: 'Dịch vụ AI đang giới hạn lượt dùng. Hãy chờ một chút rồi thử lại.',
      status: 429,
      retryable: true,
    });
  }
  if (!response.ok) {
    throw new AppError({
      code: 'UPSTREAM_ERROR',
      message: 'Dịch vụ AI hiện chưa thể trả lời. Hãy thử lại sau.',
      status: 502,
      retryable: response.status >= 500,
    });
  }

  const parsed = chatCompletionSchema.safeParse(providerPayload);
  const choice = parsed.success ? parsed.data.choices[0] : undefined;
  const content = choice?.message.content?.trim();
  if (
    !content ||
    content.length > params.maxContentLength ||
    choice?.finish_reason === 'content_filter'
  ) {
    throw new AppError({
      code: 'UPSTREAM_ERROR',
      message: 'Dịch vụ AI trả về kết quả không hợp lệ. Hãy thử lại.',
      status: 502,
      retryable: true,
    });
  }
  return content;
}
