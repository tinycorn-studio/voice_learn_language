import type { ApiErrorCode } from '@voice-chat/shared';
import type { TelegramWebAppWindow } from '../integrations/telegram/telegram-adapter.js';

export type DiagnosticCode =
  | ApiErrorCode
  | 'OK'
  | 'NETWORK_ERROR'
  | 'INVALID_CONFIG'
  | 'MISSING_INIT_DATA'
  | 'INVALID_JSON'
  | 'RESPONSE_READ_ERROR'
  | 'INVALID_ENVELOPE'
  | 'INVALID_DATA'
  | 'HTTP_ERROR'
  | 'CLIENT_ERROR';
export type DiagnosticPhase =
  'local' | 'configuration' | 'fetch' | 'json' | 'envelope' | 'api' | 'schema' | 'complete';
export type ExceptionName =
  'TypeError' | 'AbortError' | 'TimeoutError' | 'SyntaxError' | 'Error' | 'Other';

export interface ApiDiagnostic {
  readonly timestamp: string;
  readonly request_id: string;
  readonly server_request_id: string | null;
  readonly method: string;
  readonly route: string;
  readonly code: DiagnosticCode;
  readonly phase: DiagnosticPhase;
  readonly http_status: number | null;
  readonly duration_ms: number;
  readonly exception_name: ExceptionName | null;
  readonly online: boolean | null;
  readonly app_origin: string | null;
  readonly api_origin: string | null;
  readonly telegram_platform: string;
  readonly build: string;
}

/** Correlation only, never an authentication token; works without crypto.randomUUID on old iOS. */
export function createDiagnosticRequestId(): string {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = Math.floor(Math.random() * 256);
  return `web-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function safeExceptionName(error: unknown): ExceptionName {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'TypeError':
    case 'AbortError':
    case 'TimeoutError':
    case 'SyntaxError':
    case 'Error':
      return name;
    default:
      return 'Other';
  }
}

/** Only a route template is retained: word IDs, event IDs, cursors and all queries are omitted. */
export function diagnosticRoute(path: string): string {
  const route = path.split('?')[0];
  if (route?.startsWith('/api/v1/vocabulary/')) return '/api/v1/vocabulary/:word_id';
  return [
    '/health',
    '/api/v1/auth/telegram',
    '/api/v1/vocabulary',
    '/api/v1/reviews',
    '/api/v1/live-token',
  ].includes(route ?? '')
    ? route!
    : 'unknown';
}

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export function safeServerRequestId(value: string): string | null {
  // The Worker echoes our ID (or creates a UUID). Never export arbitrary response strings.
  return /^(?:web-[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
    value,
  )
    ? value
    : null;
}

/** Bounded, memory-only diagnostics. Accepts metadata only, never Request/Response/body/Error. */
export class ApiDiagnostics {
  private entries: readonly ApiDiagnostic[] = [];
  private readonly listeners = new Set<() => void>();
  public constructor(private readonly baseUrl: string) {}

  public readonly getSnapshot = (): readonly ApiDiagnostic[] => this.entries;
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public record(
    metadata: Pick<
      ApiDiagnostic,
      | 'request_id'
      | 'server_request_id'
      | 'method'
      | 'route'
      | 'code'
      | 'phase'
      | 'http_status'
      | 'duration_ms'
      | 'exception_name'
    >,
  ): ApiDiagnostic {
    const platform = (globalThis as unknown as TelegramWebAppWindow).Telegram?.WebApp?.platform;
    const build: unknown = import.meta.env['VITE_APP_VERSION'];
    const entry: ApiDiagnostic = Object.freeze({
      timestamp: new Date().toISOString(),
      request_id: safeServerRequestId(metadata.request_id) ?? 'invalid-id',
      server_request_id: safeServerRequestId(metadata.server_request_id ?? ''),
      method: ['GET', 'POST', 'PATCH', 'DELETE'].includes(metadata.method)
        ? metadata.method
        : 'unknown',
      route: diagnosticRoute(metadata.route),
      code: metadata.code,
      phase: metadata.phase,
      http_status: metadata.http_status,
      duration_ms: Math.max(0, Math.round(metadata.duration_ms)),
      exception_name: metadata.exception_name,
      online:
        typeof globalThis.navigator?.onLine === 'boolean' ? globalThis.navigator.onLine : null,
      app_origin: safeOrigin(globalThis.location?.origin ?? ''),
      api_origin: safeOrigin(this.baseUrl.trim() || globalThis.location?.origin || ''),
      telegram_platform: [
        'ios',
        'android',
        'tdesktop',
        'macos',
        'web',
        'weba',
        'webk',
        'unigram',
      ].includes(platform ?? '')
        ? platform!
        : 'unknown',
      build:
        typeof build === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(build) ? build : 'development',
    });
    this.entries = Object.freeze([...this.entries.slice(-29), entry]);
    if (entry.code !== 'OK') console.warn('mini_app_api_failure', JSON.stringify(entry));
    this.listeners.forEach((listener) => listener());
    return entry;
  }

  public exportReport(): string {
    return JSON.stringify(
      { format: 'mini-app-api-diagnostics-v1', attempts: this.entries },
      null,
      2,
    );
  }
}
