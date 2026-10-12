import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningApiClient } from './learning-api-client.js';

const session = {
  session_token: 'synthetic-session',
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  user_id: 'telegram:123',
};
const authResponse = () =>
  new Response(JSON.stringify({ ok: true, data: session, request_id: 'test-request' }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('M5-08 native fetch receiver', () => {
  it.each(['default', 'injected'])(
    'uses the global receiver for %s fetch like Window.fetch requires',
    async (mode) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const nativeLikeFetch = vi.fn(function (
        this: unknown,
        _url: RequestInfo | URL,
        _init?: RequestInit,
      ) {
        if (this !== globalThis)
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        return Promise.resolve(authResponse());
      });
      vi.stubGlobal('fetch', nativeLikeFetch);
      const api =
        mode === 'default'
          ? new LearningApiClient('https://worker.example', () => 'synthetic-init')
          : new LearningApiClient(
              'https://worker.example',
              () => 'synthetic-init',
              nativeLikeFetch,
            );
      await expect(api.authenticate()).resolves.toEqual(session);
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
      expect(nativeLikeFetch.mock.contexts[0]).toBe(globalThis);
      expect(api.diagnostics.getSnapshot()[0]).toMatchObject({ code: 'OK', http_status: 200 });
    },
  );
});

describe('M5-06 Mini App API connection', () => {
  it('authenticates on WebViews without AbortSignal.timeout', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      throw new TypeError('AbortSignal.timeout is not a function');
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(authResponse());
    const client = new LearningApiClient(
      'https://worker.example',
      () => 'signed-init-data',
      fetchFn,
    );
    await expect(client.authenticate()).resolves.toEqual(session);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    'https://YOUR-WORKER.workers.dev',
    'not-a-url',
    'ftp://worker.example',
    'https://name:password@worker.example',
    'https://worker.example?token=private',
    'https://worker.example#fragment',
  ])('rejects invalid API configuration before sending initData: %s', async (baseUrl) => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new LearningApiClient(baseUrl, () => 'signed-init-data', fetchFn);
    await expect(client.authenticate()).rejects.toMatchObject({
      message: expect.stringContaining('Cấu hình'),
      retryable: false,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('normalizes whitespace and trailing slashes in the configured URL', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(authResponse());
    await new LearningApiClient(
      ' https://worker.example/// ',
      () => 'signed',
      fetchFn,
    ).authenticate();
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://worker.example/api/v1/auth/telegram');
  });

  it('preserves same-origin API routing when no separate base URL is configured', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(authResponse());
    await new LearningApiClient('', () => 'signed', fetchFn).authenticate();
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/api/v1/auth/telegram');
  });

  it('aborts slow requests after 20 seconds and allows a later login attempt', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<typeof fetch>().mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init?.signal;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new LearningApiClient('https://worker.example', () => 'signed', fetchFn);
    const failure = expect(client.authenticate()).rejects.toMatchObject({
      message: expect.stringContaining('quá chậm'),
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(20000);
    await failure;
    expect(signal?.aborted).toBe(true);
    expect(client.diagnostics.getSnapshot()[0]).toMatchObject({
      code: 'TIMEOUT',
      phase: 'fetch',
      duration_ms: 20000,
      http_status: null,
    });
    fetchFn.mockResolvedValueOnce(authResponse());
    await expect(client.authenticate()).resolves.toEqual(session);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const response = authResponse();
      vi.spyOn(response, 'json').mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
      return response;
    });
    const client = new LearningApiClient('https://worker.example', () => 'signed', fetchFn);
    const failure = expect(client.authenticate()).rejects.toMatchObject({
      message: expect.stringContaining('quá chậm'),
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(20000);
    await failure;
    expect(client.diagnostics.getSnapshot()[0]).toMatchObject({
      code: 'TIMEOUT',
      phase: 'json',
      http_status: 200,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not expose raw network errors and clears the timeout', async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('private network details'));
    const client = new LearningApiClient('https://worker.example', () => 'signed', fetchFn);
    await expect(client.authenticate()).rejects.toMatchObject({
      message: 'Không thể kết nối máy chủ. Hãy thử lại sau hoặc liên hệ người quản trị.',
      retryable: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('M5-07 API diagnostics', () => {
  it('classifies interrupted response streams separately from malformed JSON', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = authResponse();
    vi.spyOn(response, 'json').mockRejectedValue(new TypeError('private stream detail'));
    const api = new LearningApiClient(
      'https://worker.example',
      () => 'private-init',
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    await expect(api.authenticate()).rejects.toMatchObject({
      code: 'RESPONSE_READ_ERROR',
      retryable: true,
    });
    expect(api.diagnostics.getSnapshot()[0]).toMatchObject({
      phase: 'json',
      http_status: 200,
      exception_name: 'TypeError',
    });
    expect(api.diagnostics.exportReport()).not.toContain('private');
  });

  it('includes only whitelisted platform, origin and build context, never user or URL query data', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('Telegram', {
      WebApp: {
        platform: 'ios',
        initData: 'private-init',
        initDataUnsafe: { user: { id: 999, username: 'private-user' } },
      },
    });
    vi.stubEnv('VITE_APP_VERSION', 'M5-07-test');
    const api = new LearningApiClient('https://worker.example', () => '', vi.fn<typeof fetch>());
    await api.authenticate().catch(() => undefined);
    expect(api.diagnostics.getSnapshot()[0]).toMatchObject({
      telegram_platform: 'ios',
      build: 'M5-07-test',
    });
    vi.stubGlobal('Telegram', { WebApp: { platform: 'private-platform' } });
    vi.stubEnv('VITE_APP_VERSION', 'private invalid build');
    await api.authenticate().catch(() => undefined);
    expect(api.diagnostics.getSnapshot()[1]).toMatchObject({
      telegram_platform: 'unknown',
      build: 'development',
    });
    expect(api.diagnostics.exportReport()).not.toMatch(/private|username|initData|999/);
  });

  it('records each attempt once with a fresh correlation header, including a retry without randomUUID', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('private-init-data@example.com'))
      .mockResolvedValueOnce(authResponse());
    const client = new LearningApiClient(
      'https://worker.example',
      () => 'private-init-data',
      fetchFn,
    );
    await expect(client.authenticate()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await client.authenticate();
    const entries = client.diagnostics.getSnapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      phase: 'fetch',
      code: 'NETWORK_ERROR',
      http_status: null,
      exception_name: 'TypeError',
    });
    expect(entries[1]?.code).toBe('OK');
    expect(entries[0]?.request_id).not.toBe(entries[1]?.request_id);
    entries.forEach((entry, index) => {
      expect(entry.request_id).toMatch(/^web-[a-f0-9]{24}$/);
      expect(new Headers(fetchFn.mock.calls[index]?.[1]?.headers).get('x-request-id')).toBe(
        entry.request_id,
      );
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-init-data');
    expect(client.diagnostics.exportReport()).not.toContain('synthetic-session');
  });

  it('records local missing initData and invalid config without sending requests or leaking URL secrets', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchFn = vi.fn<typeof fetch>();
    const missing = new LearningApiClient('https://worker.example', () => '', fetchFn);
    await expect(missing.authenticate()).rejects.toMatchObject({ code: 'MISSING_INIT_DATA' });
    expect(missing.diagnostics.getSnapshot()[0]).toMatchObject({
      phase: 'local',
      http_status: null,
    });
    const invalid = new LearningApiClient(
      'https://user:private-password@worker.example/path?token=private-token#private-fragment',
      () => 'private-init',
      fetchFn,
    );
    await expect(invalid.authenticate()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(invalid.diagnostics.getSnapshot()[0]).toMatchObject({
      phase: 'configuration',
      api_origin: 'https://worker.example',
    });
    expect(invalid.diagnostics.exportReport()).not.toMatch(/private-|user:|\/path|token=/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['<html>private gateway content</html>', 502, 'INVALID_JSON', 'json'],
    [JSON.stringify({ private: 'body' }), 502, 'INVALID_ENVELOPE', 'envelope'],
    [
      JSON.stringify({
        ok: true,
        data: { session_token: 'private-token' },
        request_id: 'private-user-id',
      }),
      200,
      'INVALID_DATA',
      'schema',
    ],
    [
      JSON.stringify({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'private-user-id', retryable: false },
        request_id: 'private-user-id',
      }),
      403,
      'FORBIDDEN',
      'api',
    ],
    [
      JSON.stringify({ ok: true, data: session, request_id: 'private-user-id' }),
      503,
      'HTTP_ERROR',
      'api',
    ],
  ])(
    'classifies HTTP/JSON/schema errors without exporting response contents (%s)',
    async (body, status, code, phase) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const client = new LearningApiClient(
        'https://worker.example',
        () => 'private-init',
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status })),
      );
      await expect(client.authenticate()).rejects.toMatchObject({ code, status });
      expect(client.diagnostics.getSnapshot()[0]).toMatchObject({
        code,
        phase,
        http_status: status,
        server_request_id: null,
      });
      expect(client.diagnostics.exportReport()).not.toContain('private');
    },
  );

  it('keeps only 30 attempts, strips IDs/query/body/token and matches the Worker correlation ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const warn = vi.mocked(console.warn);
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const id = new Headers(init?.headers).get('x-request-id');
      return new Response(
        JSON.stringify({
          ok: false,
          request_id: id,
          error: { code: 'UPSTREAM_ERROR', message: 'private server detail', retryable: true },
        }),
        { status: 502 },
      );
    });
    fetchFn.mockResolvedValueOnce(authResponse());
    const client = new LearningApiClient('https://worker.example', () => 'private-init', fetchFn);
    await client.authenticate();
    await Promise.all(
      Array.from({ length: 35 }, () =>
        client.deleteVocabulary('private-word-id', 'private-event-id').catch(() => undefined),
      ),
    );
    const entries = client.diagnostics.getSnapshot();
    expect(entries).toHaveLength(30);
    entries.forEach((entry) => {
      expect(entry.route).toBe('/api/v1/vocabulary/:word_id');
      expect(entry.server_request_id).toBe(entry.request_id);
    });
    const report = client.diagnostics.exportReport();
    expect(report).not.toMatch(
      /private|synthetic-session|telegram:123|event_id|authorization|init_data/,
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|synthetic-session/);
  });

  it('probes health without initData, auth or preflight headers, retaining earlier failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const getInitData = vi.fn(() => '');
    const serverRequestId = '12345678-1234-4123-8123-123456789abc';
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          request_id: serverRequestId,
          data: {
            status: 'healthy',
            service: 'voice-chat-worker',
            version: '0.1.0',
            timestamp: new Date().toISOString(),
          },
        }),
      ),
    );
    const client = new LearningApiClient('https://worker.example', getInitData, fetchFn);
    await client.authenticate().catch(() => undefined);
    getInitData.mockClear();
    await client.checkConnection();
    expect(getInitData).not.toHaveBeenCalled();
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://worker.example/health');
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {},
      cache: 'no-store',
    });
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(client.diagnostics.getSnapshot().map((entry) => entry.code)).toEqual([
      'MISSING_INIT_DATA',
      'OK',
    ]);
    expect(client.diagnostics.getSnapshot()[1]?.server_request_id).toBe(serverRequestId);
  });
});
