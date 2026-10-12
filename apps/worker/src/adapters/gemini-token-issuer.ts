import { z } from 'zod';
import type { LiveTokenResponse } from '@voice-chat/shared';
import { AppError } from '../domain/env.js';

const GOOGLE_AUTH_TOKENS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';

/**
 * Mints a single-use (`uses: 1`), short-lived Gemini Live ephemeral token
 * via Google's `v1beta/auth_tokens` REST API (`docs/04_GEMINI_SETUP.md`, `M2-03`).
 * Never exposes `GEMINI_API_KEY` to the client or logs.
 */
export async function mintGeminiEphemeralToken(params: {
  geminiApiKey: string;
  model: string;
  nowMs?: number;
  fetchFn?: typeof fetch;
}): Promise<LiveTokenResponse> {
  const fetchFn = params.fetchFn ?? fetch;
  const nowMs = params.nowMs ?? Date.now();
  const expireAtIso = new Date(nowMs + 20 * 60 * 1000).toISOString();
  const newSessionExpireAtIso = new Date(nowMs + 60 * 1000).toISOString();
  const normalizedModel = params.model.startsWith('models/')
    ? params.model
    : `models/${params.model}`;

  const requestBody = {
    uses: 1,
    expireTime: expireAtIso,
    newSessionExpireTime: newSessionExpireAtIso,
    liveConnectConstraints: {
      model: normalizedModel,
      config: {
        responseModalities: ['AUDIO'],
        sessionResumption: {},
      },
    },
  };

  let res: Response;
  try {
    res = await fetchFn(GOOGLE_AUTH_TOKENS_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-goog-api-key': params.geminiApiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AppError({
      code: 'UNAVAILABLE',
      message: 'Failed to reach Gemini ephemeral token service',
      status: 503,
      retryable: true,
    });
  }

  if (res.status === 429) {
    throw new AppError({
      code: 'RATE_LIMITED',
      message:
        'Gemini Free Tier quota or rate limit reached. Please wait before starting a new voice session.',
      status: 429,
      retryable: true,
    });
  }

  if (!res.ok) {
    throw new AppError({
      code: 'UPSTREAM_ERROR',
      message: `Gemini token service returned HTTP ${res.status}`,
      status: 502,
      retryable: res.status >= 500,
    });
  }

  const parsed = z
    .object({
      name: z.string().min(1).max(4000).optional(),
      token: z.string().min(1).max(4000).optional(),
      expireTime: z.string().datetime().optional(),
    })
    .safeParse(await res.json().catch(() => null));
  const tokenValue = parsed.success ? (parsed.data.token ?? parsed.data.name) : undefined;
  if (!parsed.success || !tokenValue) {
    throw new AppError({
      code: 'UPSTREAM_ERROR',
      message: 'Gemini token service returned an empty token payload',
      status: 502,
    });
  }

  return {
    token: tokenValue,
    model: normalizedModel,
    expires_at: parsed.data.expireTime ?? expireAtIso,
  };
}
