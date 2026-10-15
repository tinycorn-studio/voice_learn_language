import { describe, expect, it, vi } from 'vitest';
import { computeTelegramInitDataHash, issueSessionToken } from './auth/telegram-auth.js';
import { handleScheduledCron, handleWorkerRequest, SecurityStateStore } from './entry.js';
import type { WorkerEnv } from './domain/env.js';

const TEST_ENV: WorkerEnv = {
  ENVIRONMENT: 'production',
  GEMINI_API_KEY: 'test_only_gemini_key_do_not_expose_in_response',
  GEMINI_MODEL: 'models/gemini-3.8-live',
  GEMINI_TRANSLATION_MODEL: 'gemini-3.5-flash-lite',
  TELEGRAM_BOT_TOKEN: 'test_only_telegram_bot_token_for_unit_tests',
  TELEGRAM_WEBHOOK_SECRET: 'tg_webhook_secret_token_test_99',
  OWNER_TELEGRAM_ID: '777888999',
  SESSION_SIGNING_SECRET: 'session_signing_secret_32_bytes_test_key_001',
  GAS_SHARED_SECRET: 'gas_shared_secret_32_bytes_test_key_000002',
  GAS_EXEC_URL: 'https://script.google.com/macros/s/FAKE_DEPLOYMENT/exec',
  ALLOWED_ORIGIN: 'https://voice-chat-learn-language.pages.dev',
};

async function buildSignedInitData(params: {
  userId: number;
  authDate: number;
  botToken: string;
  tamperHash?: boolean;
}): Promise<string> {
  const userJson = JSON.stringify({
    id: params.userId,
    first_name: 'Learner',
    username: 'learner_vn',
  });
  const entries: Array<[string, string]> = [
    ['auth_date', String(params.authDate)],
    ['query_id', 'AAHdF6IQAAAAAN0XohDhrOrc'],
    ['user', userJson],
  ];
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  let hash = await computeTelegramInitDataHash(dataCheckString, params.botToken);
  if (params.tamperHash) {
    hash = '0'.repeat(64);
  }
  const sp = new URLSearchParams();
  for (const [k, v] of entries) {
    sp.set(k, v);
  }
  sp.set('hash', hash);
  return sp.toString();
}

describe('M2 Cloudflare Worker Routes, Auth, Live Token & Cron', () => {
  const fixedNowMs = Date.parse('2026-10-12T01:00:00.000Z'); // 08:00 Asia/Ho_Chi_Minh
  const fixedNowSec = Math.floor(fixedNowMs / 1000);

  it('M2-01: GET /health returns 200 with request_id, CORS allowlist, and zero secrets', async () => {
    const req = new Request('https://worker.example/health', {
      method: 'GET',
      headers: {
        origin: 'https://voice-chat-learn-language.pages.dev',
        'x-request-id': 'req_health_001',
      },
    });
    const res = await handleWorkerRequest(req, TEST_ENV, { nowMs: () => fixedNowMs });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://voice-chat-learn-language.pages.dev',
    );
    const rawText = await res.text();
    expect(rawText).not.toContain(TEST_ENV.GEMINI_API_KEY);
    expect(rawText).not.toContain(TEST_ENV.TELEGRAM_BOT_TOKEN);
    const body = JSON.parse(rawText) as { ok: boolean; request_id: string };
    expect(body.ok).toBe(true);
    expect(body.request_id).toBe('req_health_001');
  });

  it('M2-02: POST /api/v1/auth/telegram verifies valid initData and rejects tampered, expired, or non-owner initData (TC-08)', async () => {
    // 1. Valid owner initData -> 200
    const validInitData = await buildSignedInitData({
      userId: 777888999,
      authDate: fixedNowSec - 30,
      botToken: TEST_ENV.TELEGRAM_BOT_TOKEN,
    });
    const okRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ init_data: validInitData }),
      }),
      TEST_ENV,
      { nowMs: () => fixedNowMs },
    );
    expect(okRes.status).toBe(200);
    const okJson = (await okRes.json()) as {
      ok: boolean;
      data: { session_token: string; user_id: string };
    };
    expect(okJson.ok).toBe(true);
    expect(okJson.data.user_id).toBe('telegram:777888999');

    // 2. Tampered hash -> 401
    const tamperedInitData = await buildSignedInitData({
      userId: 777888999,
      authDate: fixedNowSec - 30,
      botToken: TEST_ENV.TELEGRAM_BOT_TOKEN,
      tamperHash: true,
    });
    const tamperedRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ init_data: tamperedInitData }),
      }),
      TEST_ENV,
      { nowMs: () => fixedNowMs },
    );
    expect(tamperedRes.status).toBe(401);

    // 3. Expired auth_date (> 3600s old) -> 401
    const expiredInitData = await buildSignedInitData({
      userId: 777888999,
      authDate: fixedNowSec - 7200,
      botToken: TEST_ENV.TELEGRAM_BOT_TOKEN,
    });
    const expiredRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ init_data: expiredInitData }),
      }),
      TEST_ENV,
      { nowMs: () => fixedNowMs },
    );
    expect(expiredRes.status).toBe(401);

    // 4. Valid signature but user not in allowlist -> 403
    const intruderInitData = await buildSignedInitData({
      userId: 111222333,
      authDate: fixedNowSec - 10,
      botToken: TEST_ENV.TELEGRAM_BOT_TOKEN,
    });
    const forbiddenRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ init_data: intruderInitData }),
      }),
      TEST_ENV,
      { nowMs: () => fixedNowMs },
    );
    expect(forbiddenRes.status).toBe(403);
  });

  it('M2-03: POST /api/v1/live-token mints single-use ephemeral token for verified user and enforces rate limit (429)', async () => {
    const session = await issueSessionToken({
      userId: 'telegram:777888999',
      signingSecret: TEST_ENV.SESSION_SIGNING_SECRET!,
      nowEpochSeconds: fixedNowSec,
    });

    const fakeFetch = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        expect(urlStr).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
        const sentBody = JSON.parse(String(init?.body)) as { uses: number };
        expect(sentBody.uses).toBe(1);
        return new Response(
          JSON.stringify({
            name: 'ephemeral_tok_single_use_xyz',
            expireTime: new Date(fixedNowMs + 1200_000).toISOString(),
          }),
          { status: 200 },
        );
      });

    const store = new SecurityStateStore();

    for (let i = 0; i < 5; i++) {
      const res = await handleWorkerRequest(
        new Request('https://worker.example/api/v1/live-token', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ session_purpose: 'voice_chat' }),
        }),
        TEST_ENV,
        { fetchFn: fakeFetch, nowMs: () => fixedNowMs },
        store,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      expect(text).not.toContain(TEST_ENV.GEMINI_API_KEY);
      expect(text).toContain('ephemeral_tok_single_use_xyz');
    }

    // 6th call within 1 minute hits per-user rate limit -> 429
    const rateLimitedRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/live-token', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
      }),
      TEST_ENV,
      { fetchFn: fakeFetch, nowMs: () => fixedNowMs },
      store,
    );
    expect(rateLimitedRes.status).toBe(429);
  });

  it('M2-02 & M4-02: POST /telegram/webhook verifies secret header and deduplicates update_id (TC-09)', async () => {
    const store = new SecurityStateStore();
    const recordReviewSpy = vi.fn().mockResolvedValue({
      review_id: 'rev_1',
      word_id: 'w_123',
      next_due_at: '2026-10-13T01:00:00.000Z',
      interval_days: 1,
      repetitions: 1,
      ease_factor: 2.5,
      review_state: 'review',
      duplicate_event: false,
    });
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    // 1. Missing/wrong secret header -> 401
    const badSecretRes = await handleWorkerRequest(
      new Request('https://worker.example/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong_secret' },
        body: JSON.stringify({ update_id: 1001 }),
      }),
      TEST_ENV,
      { fetchFn: fakeFetch, nowMs: () => fixedNowMs },
      store,
    );
    expect(badSecretRes.status).toBe(401);

    // 2. Valid callback_query update -> 200 and records review once
    const updatePayload = JSON.stringify({
      update_id: 5001,
      callback_query: {
        id: 'cbq_1',
        from: { id: 777888999 },
        data: 'r:w_123:good',
      },
    });

    const firstRes = await handleWorkerRequest(
      new Request('https://worker.example/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': TEST_ENV.TELEGRAM_WEBHOOK_SECRET },
        body: updatePayload,
      }),
      TEST_ENV,
      {
        fetchFn: fakeFetch,
        nowMs: () => fixedNowMs,
        reviewRepo: {
          listDue: vi.fn(),
          preview: vi.fn(),
          recordReview: recordReviewSpy,
          getStats: vi.fn(),
          claimDailyDigest: vi.fn(),
          finishDailyDigest: vi.fn(),
          updateUserPreferences: vi.fn(),
        },
      },
      store,
    );
    expect(firstRes.status).toBe(200);
    expect(recordReviewSpy).toHaveBeenCalledTimes(1);

    // 3. Duplicate delivery of same update_id -> deduplicated, does not double-record
    const dupRes = await handleWorkerRequest(
      new Request('https://worker.example/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': TEST_ENV.TELEGRAM_WEBHOOK_SECRET },
        body: updatePayload,
      }),
      TEST_ENV,
      {
        fetchFn: fakeFetch,
        nowMs: () => fixedNowMs,
        reviewRepo: {
          listDue: vi.fn(),
          preview: vi.fn(),
          recordReview: recordReviewSpy,
          getStats: vi.fn(),
          claimDailyDigest: vi.fn(),
          finishDailyDigest: vi.fn(),
          updateUserPreferences: vi.fn(),
        },
      },

      store,
    );
    expect(dupRes.status).toBe(200);
    expect(recordReviewSpy).toHaveBeenCalledTimes(1);
  });

  it('M2-04 & M4-03: handleScheduledCron sends 1 digest at 08:00 +07 (01:00 UTC) and respects opt-out / duplicate claims (TC-12)', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
      );

    const claimSpy = vi
      .fn()
      .mockResolvedValueOnce({
        dispatch_id: '2026-10-12|telegram:777888999',
        already_dispatched: false,
        claim_token: 'test-claim-token',
        notifications_enabled: true,
        telegram_chat_id: '777888999',
        due_cards: [
          {
            review_id: 'rev_due_1',
            word_id: 'w_123',
            word: 'overwhelmed',
            lemma: 'overwhelmed',
            part_of_speech: 'adjective',
            meaning_vi: 'quá tải',
            example: 'I feel overwhelmed.',
            source_excerpt: 'What does overwhelmed mean?',
            due_at: '2026-10-12T00:00:00.000Z',
            review_state: 'review',
            repetitions: 1,
            interval_days: 1,
            ease_factor: 2.5,
            version: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        dispatch_id: '2026-10-12|telegram:777888999',
        already_dispatched: true,
        notifications_enabled: true,
        telegram_chat_id: '777888999',
        due_cards: [],
      })
      .mockResolvedValueOnce({
        dispatch_id: '2026-10-13|telegram:777888999',
        already_dispatched: false,
        notifications_enabled: false,
        telegram_chat_id: '777888999',
        due_cards: [],
      });

    const mockReviewRepo = {
      listDue: vi.fn(),
      preview: vi.fn(),
      recordReview: vi.fn(),
      getStats: vi.fn(),
      claimDailyDigest: claimSpy,
      finishDailyDigest: vi.fn().mockResolvedValue({ updated: true }),
      updateUserPreferences: vi.fn(),
    };

    // First cron invocation at 01:00 UTC (08:00 +07 on 2026-10-12) -> sends 1 Telegram message
    const firstRun = await handleScheduledCron(fixedNowMs, TEST_ENV, {
      fetchFn: fakeFetch,
      reviewRepo: mockReviewRepo,
    });
    expect(firstRun.dispatched).toBe(true);
    expect(firstRun.localDate).toBe('2026-10-12');
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    // Retry on same local day -> already_dispatched, sends 0 additional messages
    const secondRun = await handleScheduledCron(fixedNowMs + 60_000, TEST_ENV, {
      fetchFn: fakeFetch,
      reviewRepo: mockReviewRepo,
    });
    expect(secondRun.dispatched).toBe(false);
    expect(secondRun.reason).toBe('already_dispatched');
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    // User opted out (/pause) -> notifications_disabled, sends 0 messages
    const pausedRun = await handleScheduledCron(fixedNowMs + 86400_000, TEST_ENV, {
      fetchFn: fakeFetch,
      reviewRepo: mockReviewRepo,
    });
    expect(pausedRun.dispatched).toBe(false);
    expect(pausedRun.reason).toBe('notifications_disabled');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe('M8-01 authenticated on-demand transcript translation route', () => {
  const nowMs = Date.parse('2026-10-15T04:00:00.000Z');
  const nowSeconds = Math.floor(nowMs / 1000);

  async function translationSession(): Promise<string> {
    const session = await issueSessionToken({
      userId: 'telegram:777888999',
      signingSecret: TEST_ENV.SESSION_SIGNING_SECRET!,
      nowEpochSeconds: nowSeconds,
    });
    return session.token;
  }

  it('translates a validated selected line without exposing the model key or logging transcript', async () => {
    const token = await translationSession();
    const selectedText = 'I felt overwhelmed after the meeting.';
    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      );
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(TEST_ENV.GEMINI_API_KEY);
      const payload = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      expect(payload.contents[0]?.parts[0]?.text).toBe(selectedText);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Tôi cảm thấy quá tải sau cuộc họp.' }] } }],
        }),
        { status: 200 },
      );
    });
    const response = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/translate', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          origin: 'https://voice-chat-learn-language.pages.dev',
        },
        body: JSON.stringify({ text: selectedText }),
      }),
      TEST_ENV,
      { fetchFn: fakeFetch, nowMs: () => nowMs },
      new SecurityStateStore(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(TEST_ENV.ALLOWED_ORIGIN);
    const bodyText = await response.text();
    expect(bodyText).toContain('Tôi cảm thấy quá tải sau cuộc họp.');
    expect(bodyText).not.toContain(TEST_ENV.GEMINI_API_KEY);
    expect(bodyText).not.toContain(selectedText);
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('rejects missing auth and invalid or oversized text before calling Gemini', async () => {
    const fakeFetch = vi.fn<typeof fetch>();
    const noAuth = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'A sentence.' }),
      }),
      TEST_ENV,
      { fetchFn: fakeFetch, nowMs: () => nowMs },
      new SecurityStateStore(),
    );
    expect(noAuth.status).toBe(401);

    const token = await translationSession();
    const invalid = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/translate', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'x'.repeat(501) }),
      }),
      TEST_ENV,
      { fetchFn: fakeFetch, nowMs: () => nowMs },
      new SecurityStateStore(),
    );
    expect(invalid.status).toBe(400);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('limits translation requests per authenticated user and isolate', async () => {
    const token = await translationSession();
    const fakeFetch = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Bản dịch.' }] } }] }),
        { status: 200 },
      ),
    );
    const store = new SecurityStateStore();
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await handleWorkerRequest(
        new Request('https://worker.example/api/v1/translate', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: `Sentence ${attempt}.` }),
        }),
        TEST_ENV,
        { fetchFn: fakeFetch, nowMs: () => nowMs },
        store,
      );
      expect(response.status).toBe(200);
    }
    const limited = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/translate', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'A thirteenth sentence.' }),
      }),
      TEST_ENV,
      { fetchFn: fakeFetch, nowMs: () => nowMs },
      store,
    );
    expect(limited.status).toBe(429);
    expect(fakeFetch).toHaveBeenCalledTimes(12);
  });
});
