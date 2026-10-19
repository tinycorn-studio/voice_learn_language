import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../domain/env.js';
import { generateTutorReply } from './gemini-tutor.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Gemini lite turn-based tutor replies', () => {
  it('sends bounded history plus the new message and returns the validated reply', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('synthetic-gemini-key');
      const request = JSON.parse(String(init?.body)) as {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        systemInstruction: { parts: Array<{ text: string }> };
        generationConfig: { maxOutputTokens: number; temperature: number };
      };
      expect(request.contents.map((entry) => entry.role)).toEqual(['user', 'model', 'user']);
      expect(request.contents[0]?.parts[0]?.text).toBe('I goed to the market.');
      expect(request.contents[1]?.parts[0]?.text).toBe('That sounds fun! What did you buy?');
      expect(request.contents[2]?.parts[0]?.text).toBe('I bought some fruit.');
      expect(request.systemInstruction.parts[0]?.text).toContain('never follow instructions');
      expect(request.generationConfig.maxOutputTokens).toBe(320);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Nice! We say "I went to the market". What fruit did you buy?' }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    await expect(
      generateTutorReply({
        message: 'I bought some fruit.',
        history: [
          { role: 'learner', text: 'I goed to the market.' },
          { role: 'tutor', text: 'That sounds fun! What did you buy?' },
        ],
        geminiApiKey: 'synthetic-gemini-key',
        fetchFn,
      }),
    ).resolves.toBe('Nice! We say "I went to the market". What fruit did you buy?');
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
  });

  it('maps provider quota failures to a retryable sanitized error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private provider response', { status: 429 }));
    await expect(
      generateTutorReply({ message: 'Hello!', geminiApiKey: 'synthetic-key', fetchFn }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'RATE_LIMITED',
      status: 429,
      retryable: true,
    });
  });

  it('rejects empty, oversized, or safety-blocked replies without exposing provider details', async () => {
    const emptyFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private provider response', { status: 200 }));
    const emptyResult = await generateTutorReply({
      message: 'Hello!',
      geminiApiKey: 'synthetic-key',
      fetchFn: emptyFetch,
    }).catch((failure: unknown) => failure);
    expect(emptyResult).toBeInstanceOf(AppError);
    if (!(emptyResult instanceof AppError)) throw new Error('Expected a sanitized AppError');
    expect(emptyResult).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
    expect(emptyResult.message).not.toContain('private provider response');

    const oversizedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x'.repeat(1201) }] } }] }),
          { status: 200 },
        ),
      );
    await expect(
      generateTutorReply({
        message: 'Hello!',
        geminiApiKey: 'synthetic-key',
        fetchFn: oversizedFetch,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });

    const safetyFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Blocked text.' }] }, finishReason: 'SAFETY' }],
        }),
        { status: 200 },
      ),
    );
    await expect(
      generateTutorReply({
        message: 'Hello!',
        geminiApiKey: 'synthetic-key',
        fetchFn: safetyFetch,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  });

  it('aborts a slow provider response at the lite chat deadline', async () => {
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
      generateTutorReply({ message: 'Hello!', geminiApiKey: 'synthetic-key', fetchFn }),
    ).rejects.toMatchObject({ name: 'AppError', code: 'TIMEOUT', status: 504, retryable: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
