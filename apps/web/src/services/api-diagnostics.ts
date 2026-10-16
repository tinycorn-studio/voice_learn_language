import type { ApiErrorCode } from '@voice-chat/shared';
import type { TelegramWebAppWindow } from '../integrations/telegram/telegram-adapter.js';
import {
  captureDiagnosticSchema,
  type CaptureDiagnostic,
} from '../features/voice/services/capture-diagnostics.js';
import { startupDiagnosticSchema, type StartupDiagnostic } from './startup-diagnostics.js';

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

export interface LatencyPercentiles {
  readonly metric: string;
  readonly sample_count: number;
  readonly p50_ms: number;
  readonly p95_ms: number;
}

/** Interpolated quantiles for the bounded, in-memory samples shown in diagnostics. */
export function summarizeLatency(metric: string, values: readonly number[]): LatencyPercentiles | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  if (sorted.length === 0) return null;

  const quantile = (fraction: number) => {
    const position = (sorted.length - 1) * fraction;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sorted[lowerIndex] ?? 0;
    const upper = sorted[upperIndex] ?? lower;
    return Math.round(lower + (upper - lower) * (position - lowerIndex));
  };

  return {
    metric,
    sample_count: sorted.length,
    p50_ms: quantile(0.5),
    p95_ms: quantile(0.95),
  };
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
  if (route?.startsWith('/api/v1/reviews/') && route.endsWith('/preview'))
    return '/api/v1/reviews/:card_id/preview';
  return [
    '/health',
    '/api/v1/auth/telegram',
    '/api/v1/vocabulary',
    '/api/v1/reviews',
    '/api/v1/reviews/submit',
    '/api/v1/reviews/due',
    '/api/v1/reviews/stats',
    '/api/v1/live-token',
    '/api/v1/translate',
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
  private capture: readonly (CaptureDiagnostic & { timestamp: string })[] = [];
  private startup: readonly (StartupDiagnostic & { timestamp: string })[] = [];
  private readonly listeners = new Set<() => void>();
  public constructor(private readonly baseUrl: string) {}

  public readonly getSnapshot = (): readonly ApiDiagnostic[] => this.entries;
  public readonly getCaptureSnapshot = () => this.capture;
  public readonly getStartupSnapshot = () => this.startup;
  public getLatencySummary(): readonly LatencyPercentiles[] {
    const samples = new Map<string, number[]>();
    const add = (metric: string, value: number) => {
      const bucket = samples.get(metric) ?? [];
      bucket.push(value);
      samples.set(metric, bucket);
    };

    for (const attempt of this.entries)
      add(`API ${attempt.method} ${attempt.route}`, attempt.duration_ms);
    for (const capture of this.capture) {
      if (
        (capture.stage === 'persistence_saved' || capture.stage === 'persistence_failed') &&
        capture.persistence_duration_ms !== undefined
      ) {
        add(`Vocabulary persistence (${capture.stage})`, capture.persistence_duration_ms);
      }
    }
    for (const startup of this.startup) {
      const duration =
        startup.duration_ms ?? (startup.stage === 'voice_ready' ? startup.elapsed_ms : null);
      if (duration !== null) add(`Startup ${startup.stage}`, duration);
    }

    return Array.from(samples, ([metric, values]) => summarizeLatency(metric, values)).filter(
      (summary): summary is LatencyPercentiles => summary !== null,
    );
  }
  public recordStartup(metadata: StartupDiagnostic): void {
    const parsed = startupDiagnosticSchema.safeParse(metadata);
    if (!parsed.success) return;
    this.startup = Object.freeze([
      ...this.startup.slice(-29),
      Object.freeze({ ...parsed.data, timestamp: new Date().toISOString() }),
    ]);
    this.listeners.forEach((listener) => listener());
  }
  public recordCapture(metadata: CaptureDiagnostic): void {
    const parsed = captureDiagnosticSchema.safeParse(metadata);
    if (!parsed.success) return;
    this.capture = Object.freeze([
      ...this.capture.slice(-99),
      Object.freeze({
        ...parsed.data,
        timestamp: new Date().toISOString(),
      }),
    ]);
    this.listeners.forEach((listener) => listener());
  }
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
      {
        format: 'mini-app-api-diagnostics-v1',
        attempts: this.entries,
        capture: this.capture,
        startup: this.startup,
        latency_summary: this.getLatencySummary(),
      },
      null,
      2,
    );
  }
}
