import { describe, expect, it, vi } from 'vitest';
import { mintGeminiEphemeralToken } from './gemini-token-issuer.js';

describe('Gemini token REST contract (M5-10)', () => {
  it.each(['gemini-3.8-live', 'models/gemini-3.8-live'])(
    'sends REST setup constraints for %s and leaves other client setup fields available',
    async (model) => {
      const nowMs = Date.parse('2026-10-13T02:40:36.000Z');
      const apiKey = 'synthetic-server-only-key';
      const token = 'auth_tokens/synthetic-single-use';
      const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(apiKey);
        const body: unknown = JSON.parse(String(init?.body));
        // AuthToken REST uses BidiGenerateContentSetup, not the SDK config wrapper.
        // The Google Discovery schema and live API reject the old field with HTTP 400.
        expect(body).toEqual({
          uses: 1,
          expireTime: '2026-10-13T03:00:36.000Z',
          newSessionExpireTime: '2026-10-13T02:41:36.000Z',
          bidiGenerateContentSetup: {
            model: 'models/gemini-3.8-live',
            generationConfig: { responseModalities: ['AUDIO'] },
          },
          // An absent mask ignores the client's tools, instructions and resumption handle.
          fieldMask: 'model,generationConfig.responseModalities',
        });
        return Response.json({ name: token });
      });

      const result = await mintGeminiEphemeralToken({
        geminiApiKey: apiKey,
        model,
        nowMs,
        fetchFn,
      });

      expect(fetchFn).toHaveBeenCalledOnce();
      expect(result).toEqual({
        token,
        model: 'models/gemini-3.8-live',
        expires_at: '2026-10-13T03:00:36.000Z',
      });
      expect(JSON.stringify(result)).not.toContain(apiKey);
    },
  );
});
