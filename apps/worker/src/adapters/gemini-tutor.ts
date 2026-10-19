import { z } from 'zod';
import { AppError } from '../domain/env.js';
import { TUTOR_SYSTEM_INSTRUCTION } from './text-prompts.js';

const GEMINI_GENERATE_CONTENT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash-lite';
const MAX_PROVIDER_WAIT_MS = 10_000;
const MAX_REPLY_LENGTH = 1_200;

export interface TutorHistoryTurn {
  role: 'learner' | 'tutor';
  text: string;
}

const providerResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(z.object({ text: z.string().max(4096).optional() }).passthrough()),
      }),
      finishReason: z.string().optional(),
    }),
  ),
});

/**
 * Generates one tutor reply for the turn-based "lite" conversation mode (`M9-01`).
 * The learner message and bounded history are sent to Gemini for this request only and are
 * never logged or persisted here. Only sanitized errors leave this function.
 */
export async function generateTutorReply(params: {
  message: string;
  history?: TutorHistoryTurn[];
  geminiApiKey: string;
  model?: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const fetchFn = params.fetchFn ?? fetch;
  const model = (params.model ?? DEFAULT_CHAT_MODEL).replace(/^models\//, '').trim();
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/i.test(model) || !params.geminiApiKey.trim()) {
    throw new AppError({
      code: 'UNAVAILABLE',
      message: 'Chế độ hội thoại nhẹ chưa được cấu hình.',
      status: 503,
      retryable: false,
    });
  }

  const contents = [
    ...(params.history ?? []).map((turn) => ({
      role: turn.role === 'learner' ? 'user' : 'model',
      parts: [{ text: turn.text }],
    })),
    { role: 'user', parts: [{ text: params.message }] },
  ];

  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAX_PROVIDER_WAIT_MS);

  let response: Response;
  let providerPayload: unknown;
  try {
    response = await fetchFn.call(
      globalThis,
      `${GEMINI_GENERATE_CONTENT_ENDPOINT}${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-goog-api-key': params.geminiApiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: TUTOR_SYSTEM_INSTRUCTION }] },
          contents,
          generationConfig: { temperature: 0.6, maxOutputTokens: 320 },
        }),
        signal: controller.signal,
      },
    );
    providerPayload = await response.json().catch(() => null);
  } catch {
    if (timedOut) {
      throw new AppError({
        code: 'TIMEOUT',
        message: 'Chế độ hội thoại nhẹ phản hồi quá chậm. Hãy thử lại.',
        status: 504,
        retryable: true,
      });
    }
    throw new AppError({
      code: 'UNAVAILABLE',
      message: 'Không thể kết nối chế độ hội thoại nhẹ. Hãy thử lại.',
      status: 503,
      retryable: true,
    });
  } finally {
    globalThis.clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new AppError({
      code: 'RATE_LIMITED',
      message: 'Gemini đang giới hạn lượt hội thoại nhẹ. Hãy chờ một chút rồi thử lại.',
      status: 429,
      retryable: true,
    });
  }
  if (!response.ok) {
    throw new AppError({
      code: 'UPSTREAM_ERROR',
      message: 'Gemini hiện chưa thể trả lời trong chế độ nhẹ. Hãy thử lại sau.',
      status: 502,
      retryable: response.status >= 500,
    });
  }

  const parsed = providerResponseSchema.safeParse(providerPayload);
  const candidate = parsed.success ? parsed.data.candidates[0] : undefined;
  const reply = candidate?.content.parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!reply || reply.length > MAX_REPLY_LENGTH || candidate?.finishReason === 'SAFETY') {
    throw new AppError({
      code: 'UPSTREAM_ERROR',
      message: 'Gemini trả về câu trả lời không hợp lệ. Hãy thử lại.',
      status: 502,
      retryable: true,
    });
  }
  return reply;
}
