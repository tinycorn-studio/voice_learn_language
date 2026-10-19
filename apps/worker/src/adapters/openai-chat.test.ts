import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../domain/env.js';
import { requestOpenAiCompatibleChat, resolveOpenAiChatConfig } from './openai-chat.js';

afterEach(() => {
  vi.useRealTimers();
});

const CONFIG = {
  baseUrl: 'https://api.z.ai/api/paas/v4',
  apiKey: 'synthetic-text-key',
  model: 'glm-4.7-flash',
};

const BASE_PARAMS = {
  config: CONFIG,
  system: 'You are a tutor.',
  messages: [{ role: 'user' as const, content: 'Hello!' }],
  temperature: 0.6,
  maxTokens: 320,
  maxContentLength: 1_200,
};

describe('OpenAI-compatible chat completion adapter (M9-05)', () => {
  it('posts a bounded chat completion and returns the trimmed assistant text', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.z.ai/api/paas/v4/chat/completions');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-text-key');
      const payload = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature: number;
        max_tokens: number;
        stream: boolean;
      };
      expect(payload.model).toBe('glm-4.7-flash');
      expect(payload.messages.map((entry) => entry.role)).toEqual(['system', 'user']);
      expect(payload.messages[0]?.content).toBe('You are a tutor.');
      expect(payload.temperature).toBe(0.6);
      expect(payload.max_tokens).toBe(320);
      expect(payload.stream).toBe(false);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '  Nice! What did you buy?  ' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      );
    });

    await expect(requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn })).resolves.toBe(
      'Nice! What did you buy?',
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('maps provider quota failures to a retryable sanitized error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private provider response', { status: 429 }));
    const failure = await requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AppError);
    if (!(failure instanceof AppError)) throw new Error('Expected a sanitized AppError');
    expect(failure).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryable: true });
    expect(failure.message).not.toContain('private provider response');
  });

  it('maps server and client failures to UPSTREAM_ERROR with matching retryability', async () => {
    const serverFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private provider response', { status: 500 }));
    await expect(
      requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn: serverFetch }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502, retryable: true });

    const clientFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private provider response', { status: 400 }));
    await expect(
      requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn: clientFetch }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502, retryable: false });
  });

  it('maps network failures to a retryable UNAVAILABLE error', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn })).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAVAILABLE',
      status: 503,
      retryable: true,
    });
  });

  it('aborts a slow provider response at the text-provider deadline', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const result = expect(
      requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn }),
    ).rejects.toMatchObject({ name: 'AppError', code: 'TIMEOUT', status: 504, retryable: true });
    await vi.advanceTimersByTimeAsync(8_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects empty, oversized, or filtered completions without exposing provider details', async () => {
    const emptyFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), {
        status: 200,
      }),
    );
    const emptyResult = await requestOpenAiCompatibleChat({
      ...BASE_PARAMS,
      fetchFn: emptyFetch,
    }).catch((error: unknown) => error);
    expect(emptyResult).toBeInstanceOf(AppError);
    if (!(emptyResult instanceof AppError)) throw new Error('Expected a sanitized AppError');
    expect(emptyResult).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });

    const oversizedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(1201) } }] }), {
        status: 200,
      }),
    );
    await expect(
      requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn: oversizedFetch }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });

    const filteredFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Blocked text.' }, finish_reason: 'content_filter' }],
        }),
        { status: 200 },
      ),
    );
    await expect(
      requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn: filteredFetch }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });

    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(
      requestOpenAiCompatibleChat({ ...BASE_PARAMS, fetchFn: malformedFetch }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  });
});

describe('OpenAI-compatible endpoint configuration (M9-05)', () => {
  it('accepts HTTPS bases, strips trailing slashes, and keeps the model id intact', () => {
    expect(
      resolveOpenAiChatConfig({
        baseUrl: 'https://api.z.ai/api/paas/v4/',
        apiKey: ' key ',
        model: 'glm-4.7-flash',
      }),
    ).toEqual({ baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'key', model: 'glm-4.7-flash' });
    expect(
      resolveOpenAiChatConfig({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'key',
        model: 'deepseek-flash',
      }),
    ).not.toBeNull();
  });

  it('rejects unsafe or incomplete configuration', () => {
    const invalid = [
      { baseUrl: 'http://api.z.ai/api/paas/v4', apiKey: 'k', model: 'glm-4.7-flash' },
      { baseUrl: 'https://user:pass@api.z.ai/api/paas/v4', apiKey: 'k', model: 'glm-4.7-flash' },
      { baseUrl: 'https://api.z.ai/api/paas/v4?token=1', apiKey: 'k', model: 'glm-4.7-flash' },
      { baseUrl: 'https://api.z.ai#frag', apiKey: 'k', model: 'glm-4.7-flash' },
      { baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: '', model: 'glm-4.7-flash' },
      { baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'k', model: 'models/glm-4.7' },
      { baseUrl: '', apiKey: 'k', model: 'glm-4.7-flash' },
    ];
    for (const config of invalid) {
      expect(resolveOpenAiChatConfig(config)).toBeNull();
    }
  });
});
