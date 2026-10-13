import { afterEach, describe, expect, it, vi } from 'vitest';
import { GasRepositoryAdapter } from './gas-client.js';
import { TelegramBotClient } from './telegram-bot-client.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('M5-09 Workers native fetch receiver', () => {
  it.each([
    [
      'TypeError',
      'Illegal invocation: private secret in message',
      'ILLEGAL_INVOCATION',
      'TypeError',
    ],
    ['TypeError', 'private endpoint or HMAC detail', 'FETCH_FAILED', 'TypeError'],
    ['TimeoutError', 'private timeout detail', 'TIMEOUT', 'TimeoutError'],
    ['private-error-name', 'private detail', 'FETCH_FAILED', 'Other'],
  ])('logs only whitelisted failure metadata for %s', async (name, message, reason, safeName) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new Error(message);
    failure.name = name;
    const adapter = new GasRepositoryAdapter(
      'https://private-endpoint.example/exec?private=query',
      'private-hmac-secret',
      vi.fn<typeof fetch>().mockRejectedValue(failure),
    );
    await expect(
      adapter.list('telegram:987654321', 'safe-request-001', { limit: 10, search: 'private-word' }),
    ).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      status: 503,
      message: 'Google Apps Script endpoint unreachable',
      retryable: true,
    });
    expect(warn).toHaveBeenCalledOnce();
    const serialized = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(serialized)).toMatchObject({
      event: 'gas_fetch_failed',
      request_id: 'safe-request-001',
      action: 'vocabulary.list',
      phase: 'fetch',
      reason,
      exception_name: safeName,
      http_status: null,
    });
    expect(serialized).not.toMatch(/private|987654321|signature|payload|shared_secret|stack/);
  });

  it.each(['default', 'injected'])(
    'lists vocabulary with the global receiver for %s fetch',
    async (mode) => {
      const nativeLikeFetch = vi.fn(function (
        this: unknown,
        _url: RequestInfo | URL,
        _init?: RequestInit,
      ) {
        if (this !== globalThis)
          throw new TypeError('Illegal invocation: incorrect this reference');
        return Promise.resolve(Response.json({ ok: true, data: { items: [], next_cursor: null } }));
      });
      vi.stubGlobal('fetch', nativeLikeFetch);
      const adapter =
        mode === 'default'
          ? new GasRepositoryAdapter('https://gas.example/exec', 'synthetic-hmac-secret')
          : new GasRepositoryAdapter(
              'https://gas.example/exec',
              'synthetic-hmac-secret',
              nativeLikeFetch,
            );
      await expect(
        adapter.list('telegram:123', 'web-synthetic-request', { limit: 10 }),
      ).resolves.toEqual({ items: [], next_cursor: null });
      expect(nativeLikeFetch.mock.contexts[0]).toBe(globalThis);
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
    },
  );

  it.each(['default', 'injected'])(
    'uses the global receiver for Telegram send and callback with %s fetch',
    async (mode) => {
      const nativeLikeFetch = vi.fn(function (
        this: unknown,
        _url: RequestInfo | URL,
        _init?: RequestInit,
      ) {
        if (this !== globalThis)
          throw new TypeError('Illegal invocation: incorrect this reference');
        return Promise.resolve(Response.json({ ok: true, result: { message_id: 42 } }));
      });
      vi.stubGlobal('fetch', nativeLikeFetch);
      const client =
        mode === 'default'
          ? new TelegramBotClient('synthetic-bot-token')
          : new TelegramBotClient('synthetic-bot-token', nativeLikeFetch);
      await expect(
        client.sendMessage({ chatId: '123', text: 'synthetic message' }),
      ).resolves.toEqual({ ok: true, messageId: 42 });
      await expect(
        client.answerCallbackQuery({
          callbackQueryId: 'synthetic-callback',
          text: 'synthetic acknowledgement',
        }),
      ).resolves.toBe(true);
      expect(nativeLikeFetch.mock.contexts).toEqual([globalThis, globalThis]);
      expect(nativeLikeFetch).toHaveBeenCalledTimes(2);
    },
  );
});
