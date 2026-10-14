import type { ApiErrorCode, ApiEnvelope } from '@voice-chat/shared';
import type { D1Database } from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENVIRONMENT?: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OWNER_TELEGRAM_ID: string;
  SESSION_SIGNING_SECRET?: string;
  GAS_SHARED_SECRET: string;
  GAS_EXEC_URL: string;
  ALLOWED_ORIGIN?: string;
  DATA_BACKEND?: 'gas' | 'd1';
  SHEET_MIRROR_ENABLED?: 'true' | 'false';
  SHEET_MIRROR_EPOCH?: string;
  DB?: Pick<D1Database, 'prepare' | 'batch'>;
}

/**
 * Domain/Application error mapped to canonical HTTP status codes and sanitized API envelopes.
 * Stack traces and raw secrets are never exposed in responses (`AGENTS.md` Section 4 & 6).
 */
export class AppError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly retryable: boolean;

  public constructor(params: {
    code: ApiErrorCode;
    message: string;
    status: number;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.status = params.status;
    this.retryable = params.retryable ?? false;
  }
}

export function jsonEnvelopeResponse<T>(
  envelope: ApiEnvelope<T>,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': envelope.request_id,
      ...extraHeaders,
    },
  });
}

/**
 * Redacts potential secrets or tokens from log strings (`AGENTS.md` Section 4).
 */
export function redactLogValue(input: string): string {
  return input
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\b[0-9]{8,10}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_BOT_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

export function logStructured(
  level: 'info' | 'warn' | 'error',
  event: string,
  requestId: string,
  meta: Record<string, string | number | boolean | null> = {},
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    request_id: requestId,
    ...meta,
  };
  const serialized = redactLogValue(JSON.stringify(entry));
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}
