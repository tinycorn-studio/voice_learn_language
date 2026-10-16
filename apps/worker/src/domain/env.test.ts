import { afterEach, expect, it, vi } from 'vitest';
import { logStructured } from './env.js';

afterEach(() => vi.restoreAllMocks());

it('emits searchable structured logs after redaction and drops unsafe correlation IDs', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const secret = `AIza${'x'.repeat(32)}`;
  logStructured('info', 'api_request_complete', 'web-1234567890abcdef12345678', {
    route: '/api/v1/vocabulary',
    duration_ms: 84,
    diagnostic: secret,
  });
  logStructured('info', 'api_request_complete', 'private learner text', { duration_ms: 1 });

  const first = info.mock.calls[0]?.[0] as Record<string, unknown>;
  const second = info.mock.calls[1]?.[0] as Record<string, unknown>;
  expect(first).toMatchObject({
    event: 'api_request_complete',
    request_id: 'web-1234567890abcdef12345678',
    route: '/api/v1/vocabulary',
    duration_ms: 84,
  });
  expect(JSON.stringify(first)).not.toContain(secret);
  expect(JSON.stringify(first)).toContain('[REDACTED_GEMINI_KEY]');
  expect(second?.request_id).toBe('unknown');
  expect(typeof first?.ts).toBe('string');
});
