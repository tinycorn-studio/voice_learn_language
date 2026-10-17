// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';
import {
  D1RateLimiter,
  cleanupRateLimitWindows,
  createRateLimitError,
  type RateLimiter,
} from '../apps/worker/src/adapters/d1-rate-limiter.js';
import { AppError, type WorkerEnv } from '../apps/worker/src/domain/env.js';
import { handleWorkerRequest, SecurityStateStore } from '../apps/worker/src/entry.js';
import { issueSessionToken } from '../apps/worker/src/auth/telegram-auth.js';

const TEST_ENV: WorkerEnv = {
  ENVIRONMENT: 'production',
  DATA_BACKEND: 'd1',
  GEMINI_API_KEY: 'test_only_gemini_key_do_not_expose_in_response',
  GEMINI_MODEL: 'models/gemini-3.8-live',
  TELEGRAM_BOT_TOKEN: 'test_only_telegram_bot_token_for_unit_tests',
  TELEGRAM_WEBHOOK_SECRET: 'tg_webhook_secret_token_test_99',
  OWNER_TELEGRAM_ID: '777888999',
  SESSION_SIGNING_SECRET: 'session_signing_secret_32_bytes_test_key_001',
  GAS_SHARED_SECRET: 'gas_shared_secret_32_bytes_test_key_000002',
  GAS_EXEC_URL: 'https://script.google.com/macros/s/FAKE_DEPLOYMENT/exec',
  ALLOWED_ORIGIN: 'https://voice-chat-learn-language.pages.dev',
};

const runtimePromise = createD1RuntimeHarness();
afterAll(async () => (await runtimePromise).dispose());

async function setup() {
  return runtimePromise;
}

const NOW = Date.parse('2026-10-12T01:00:05.000Z');

describe('M9-02 D1 rate limiting', { timeout: 20000 }, () => {
  it('allows exactly max requests per fixed window and shares counters across instances', async () => {
    const { db } = await setup();
    const first = new D1RateLimiter(db);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(first.consume('live_token', 'telegram:1', NOW, 5)).resolves.toBeUndefined();
    }
    await expect(first.consume('live_token', 'telegram:1', NOW, 5)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    const second = new D1RateLimiter(db);
    await expect(second.consume('live_token', 'telegram:1', NOW, 5)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('rolls the window after 60 seconds and keeps scopes/users independent', async () => {
    const { db } = await setup();
    const limiter = new D1RateLimiter(db);
    for (let attempt = 0; attempt < 5; attempt++) {
      await limiter.consume('live_token', 'telegram:10', NOW, 5);
    }
    const bucketStart = Math.floor(NOW / 60_000) * 60_000;
    await expect(
      limiter.consume('live_token', 'telegram:10', bucketStart + 59_000, 5),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      limiter.consume('live_token', 'telegram:10', bucketStart + 60_000, 5),
    ).resolves.toBeUndefined();
    for (let attempt = 0; attempt < 12; attempt++) {
      await limiter.consume('translate', 'telegram:20', NOW, 12);
    }
    await expect(limiter.consume('translate', 'telegram:20', NOW, 12)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(limiter.consume('live_token', 'telegram:20', NOW, 5)).resolves.toBeUndefined();
  });

  it('cleans only windows older than the retention cutoff', async () => {
    const { db } = await setup();
    const limiter = new D1RateLimiter(db);
    await limiter.consume('translate', 'telegram:30', NOW, 12);
    await limiter.consume('translate', 'telegram:30', NOW + 120_000, 12);
    await cleanupRateLimitWindows(db, NOW + 60_000);
    const rows = await db
      .prepare(
        "SELECT window_start FROM rate_limit_windows WHERE scope='translate' AND user_id='telegram:30' ORDER BY window_start",
      )
      .all();
    expect(rows.results).toHaveLength(1);
    expect(Number(rows.results[0]?.['window_start'])).toBe(
      Math.floor(NOW / 60_000) * 60_000 + 120_000,
    );
  });

  it('falls back to the per-isolate window when D1 is unavailable, and propagates real limits', async () => {
    const store = new SecurityStateStore();
    const broken: RateLimiter = { consume: async () => Promise.reject(new Error('d1 down')) };
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(store.enforceRateLimit('live_token', broken, 'telegram:9', NOW, 5)).resolves
        .toBeUndefined;
    }
    await expect(store.enforceRateLimit('live_token', broken, 'telegram:9', NOW, 5)).rejects
      .toMatchObject({ code: 'RATE_LIMITED' });

    const rejecting: RateLimiter = { consume: async () => Promise.reject(createRateLimitError('translate')) };
    await expect(store.enforceRateLimit('translate', rejecting, 'telegram:9', NOW, 12)).rejects
      .toMatchObject({ code: 'RATE_LIMITED' });
    const memoryStore = new SecurityStateStore();
    await expect(memoryStore.enforceRateLimit('translate', null, 'telegram:9', NOW, 12)).resolves
      .toBeUndefined;
  });

  it('blocks the sixth live-token request even from a brand-new isolate store', async () => {
    const { db } = await setup();
    const env: WorkerEnv = { ...TEST_ENV, DB: db };
    const session = await issueSessionToken({
      userId: 'telegram:777888999',
      signingSecret: TEST_ENV.SESSION_SIGNING_SECRET!,
    });
    const fakeFetch: typeof fetch = async () =>
      Response.json({
        name: 'ephemeral_tok_single_use_xyz',
        expireTime: new Date(NOW + 1200_000).toISOString(),
      });
    const call = (store: SecurityStateStore) =>
      handleWorkerRequest(
        new Request('https://worker.example/api/v1/live-token', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ session_purpose: 'voice_chat' }),
        }),
        env,
        { fetchFn: fakeFetch, nowMs: () => NOW },
        store,
      );
    const firstIsolate = new SecurityStateStore();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await call(firstIsolate)).status).toBe(200);
    }
    const coldIsolate = new SecurityStateStore();
    const limited = await call(coldIsolate);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
  });
});
