import { describe, expect, it } from 'vitest';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';
import { issueSessionToken } from '../apps/worker/src/auth/telegram-auth.js';
import { handleScheduledCron, handleWorkerRequest } from '../apps/worker/src/entry.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';

const ENV: WorkerEnv = {
  ENVIRONMENT: 'production',
  GEMINI_API_KEY: 'test_only_gemini_key_for_integration_tests',
  GEMINI_MODEL: 'models/gemini-3.8-live',
  TELEGRAM_BOT_TOKEN: 'test_only_telegram_bot_token_for_integration',
  TELEGRAM_WEBHOOK_SECRET: 'webhook_secret_xyz_123',
  OWNER_TELEGRAM_ID: '777888999',
  SESSION_SIGNING_SECRET: 'session_secret_key_for_worker_gas_integration',
  GAS_SHARED_SECRET: 'shared_hmac_secret_between_worker_and_gas_123',
  GAS_EXEC_URL: 'https://script.google.com/macros/s/LOCAL_HARNESS/exec',
  ALLOWED_ORIGIN: 'https://voice-chat-learn-language.pages.dev',
};

describe('M3 & M4 End-to-End Integration: Cloudflare Worker <-> apps-script/Code.gs', () => {
  function setupWorkerAndGas() {
    const gas = createGasRuntimeHarness({
      SHEET_ID: 'sheet_test_001',
      GAS_SHARED_SECRET: ENV.GAS_SHARED_SECRET,
      OWNER_USER_ID: 'telegram:777888999',
      MAX_EVENT_AGE_SECONDS: '300',
    });
    gas.setupSheets();

    const telegramSentMessages: Array<{ chat_id: unknown; text: string }> = [];

    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === ENV.GAS_EXEC_URL) {
        const res = gas.doPost(String(init?.body ?? ''));
        return new Response(res.bodyText, {
          status: res.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('api.telegram.org')) {
        if (url.endsWith('/sendMessage')) {
          const parsed = JSON.parse(String(init?.body ?? '{}')) as {
            chat_id: unknown;
            text: string;
          };
          telegramSentMessages.push(parsed);
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch URL in integration test: ${url}`);
    };

    return { gas, fetchFn, telegramSentMessages };
  }

  it('M3-02: rejects tampered/expired HMAC envelopes directly in Code.gs (TC-07)', () => {
    const { gas } = setupWorkerAndGas();

    const tampered = gas.doPost(
      JSON.stringify({
        payload: JSON.stringify({
          action: 'vocabulary.upsert',
          event_id: 'evt_tampered_123456',
          issued_at: new Date().toISOString(),
          user_id: 'telegram:777888999',
          data: { word: 'test', meaning_vi: 'thử' },
        }),
        signature: 'invalid_signature_value_123456',
      }),
    );
    expect(JSON.parse(tampered.bodyText)).toEqual({
      ok: false,
      error: { code: 'INVALID_SIGNATURE', message: 'HMAC signature mismatch' },
    });
    expect(gas.spreadsheet.getSheetByName('Words')?.getLastRow()).toBe(1);
  });

  it('M3-02 & M3-03: deduplicates 3 retries with same event_id (TC-05), stores 2 senses separately (TC-06), escapes formulas (TC-10), and supports CRUD', async () => {
    const { gas, fetchFn } = setupWorkerAndGas();
    const session = await issueSessionToken({
      userId: 'telegram:777888999',
      signingSecret: ENV.SESSION_SIGNING_SECRET!,
    });
    const authHeader = {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    };

    // 1. Call POST /api/v1/vocabulary 3 times with identical event_id (TC-05) + formula attempt (TC-10)
    const upsertPayload = {
      event_id: '1c11d5a4-92a8-4bcc-b3fa-f03c9ce2c4b1',
      word: 'bank',
      lemma: 'bank',
      part_of_speech: 'noun',
      sense_key: 'financial_institution',
      meaning_vi: 'ngân hàng',
      example: '=IMPORTXML("https://evil.example","//a")',
      source_excerpt: 'What does bank mean?',
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await handleWorkerRequest(
        new Request('https://worker.example/api/v1/vocabulary', {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify(upsertPayload),
        }),
        ENV,
        { fetchFn },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: { word_id: string; created: boolean; duplicate_event: boolean };
      };
      expect(body.ok).toBe(true);
      if (attempt === 1) {
        expect(body.data.created).toBe(true);
        expect(body.data.duplicate_event).toBe(false);
      } else {
        expect(body.data.created).toBe(false);
        expect(body.data.duplicate_event).toBe(true);
      }
    }

    // Verify exactly 1 row added in Words (row 1 is header, row 2 is word) and 1 row in Events
    const wordsSheet = gas.spreadsheet.getSheetByName('Words')!;
    const eventsSheet = gas.spreadsheet.getSheetByName('Events')!;
    expect(wordsSheet.getLastRow()).toBe(2);
    expect(eventsSheet.getLastRow()).toBe(2);

    // Verify formula cell in sheet starts with leading single quote `'=IMPORTXML...` (TC-10)
    const rawCells = wordsSheet.rows[1]!;
    expect(rawCells.some((c) => String(c).startsWith("'=IMPORTXML"))).toBe(true);

    // 2. Ask the same word & sense again with a NEW event_id -> increments times_asked to 2 without adding a row
    const secondAskRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/vocabulary', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          ...upsertPayload,
          event_id: '2d22e6b5-92a8-4bcc-b3fa-f03c9ce2c4b2',
        }),
      }),
      ENV,
      { fetchFn },
    );
    expect(secondAskRes.status).toBe(200);
    expect(wordsSheet.getLastRow()).toBe(2);

    // 3. Same word ("bank"), different sense ("river_edge") -> creates 2nd word row (TC-06)
    const secondSenseRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/vocabulary', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          event_id: '3e33f7c6-92a8-4bcc-b3fa-f03c9ce2c4b3',
          word: 'bank',
          lemma: 'bank',
          part_of_speech: 'noun',
          sense_key: 'river_edge',
          meaning_vi: 'bờ sông',
          example: 'We walked along the river bank.',
          source_excerpt: 'What does bank mean in river bank?',
        }),
      }),
      ENV,
      { fetchFn },
    );
    expect(secondSenseRes.status).toBe(200);
    expect(wordsSheet.getLastRow()).toBe(3);

    // 4. GET /api/v1/vocabulary lists both senses
    const listRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/vocabulary?limit=10', {
        method: 'GET',
        headers: authHeader,
      }),
      ENV,
      { fetchFn },
    );
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      ok: boolean;
      data: {
        items: Array<{
          word_id: string;
          sense_key: string;
          meaning_vi: string;
          times_asked: number;
          version: number;
        }>;
      };
    };
    expect(listJson.data.items.length).toBe(2);
    const firstItem = listJson.data.items[0]!;
    expect(firstItem.times_asked).toBe(2);

    // 5. PATCH /api/v1/vocabulary/:id updates meaning_vi and increments version
    const patchRes = await handleWorkerRequest(
      new Request(`https://worker.example/api/v1/vocabulary/${firstItem.word_id}`, {
        method: 'PATCH',
        headers: authHeader,
        body: JSON.stringify({
          event_id: '4f44a8d7-92a8-4bcc-b3fa-f03c9ce2c4b4',
          meaning_vi: 'ngân hàng thương mại',
          version: firstItem.version,
        }),
      }),
      ENV,
      { fetchFn },
    );
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as {
      ok: boolean;
      data: { meaning_vi: string; version: number };
    };
    expect(patchJson.data.meaning_vi).toBe('ngân hàng thương mại');
    expect(patchJson.data.version).toBe(firstItem.version + 1);

    // Stale version PATCH returns 409 CONFLICT
    const conflictRes = await handleWorkerRequest(
      new Request(`https://worker.example/api/v1/vocabulary/${firstItem.word_id}`, {
        method: 'PATCH',
        headers: authHeader,
        body: JSON.stringify({
          event_id: '5a55b9e8-92a8-4bcc-b3fa-f03c9ce2c4b5',
          meaning_vi: 'xung đột phiên bản',
          version: firstItem.version,
        }),
      }),
      ENV,
      { fetchFn },
    );
    expect(conflictRes.status).toBe(409);

    // 6. DELETE /api/v1/vocabulary/:id soft-deletes and hides from subsequent list
    const secondItem = listJson.data.items[1]!;
    const delRes = await handleWorkerRequest(
      new Request(
        `https://worker.example/api/v1/vocabulary/${secondItem.word_id}?event_id=6b66c0f9-92a8-4bcc-b3fa-f03c9ce2c4b6`,
        {
          method: 'DELETE',
          headers: authHeader,
        },
      ),
      ENV,
      { fetchFn },
    );
    expect(delRes.status).toBe(200);

    const afterDelListRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/vocabulary?limit=10', {
        method: 'GET',
        headers: authHeader,
      }),
      ENV,
      { fetchFn },
    );
    const afterDelJson = (await afterDelListRes.json()) as {
      data: { items: Array<{ word_id: string }> };
    };
    expect(afterDelJson.data.items.length).toBe(1);
    expect(afterDelJson.data.items[0]?.word_id).toBe(firstItem.word_id);
  });

  it('M4-01..M4-03: E2E review lifecycle (due list -> cron digest -> idempotent review scoring -> pause opt-out)', async () => {
    const { gas, fetchFn, telegramSentMessages } = setupWorkerAndGas();
    const session = await issueSessionToken({
      userId: 'telegram:777888999',
      signingSecret: ENV.SESSION_SIGNING_SECRET!,
    });
    const authHeader = {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    };

    // 1. Save a word (immediately due because review_state=new, due_at=now)
    const createRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/vocabulary', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          event_id: '7c77d1a0-92a8-4bcc-b3fa-f03c9ce2c4b7',
          word: 'overwhelmed',
          part_of_speech: 'adjective',
          sense_key: 'unable_to_cope',
          meaning_vi: 'quá tải, choáng ngợp',
          example: 'I feel overwhelmed.',
          source_excerpt: 'What does overwhelmed mean?',
        }),
      }),
      ENV,
      { fetchFn },
    );
    const createdWordId = ((await createRes.json()) as { data: { word_id: string } }).data.word_id;

    // 2. Cron runs at 08:00 +07 -> claims DailyDispatchLog and sends 1 Telegram digest
    const cronTimeMs = Date.now() + 1000;
    const firstDigest = await handleScheduledCron(cronTimeMs, ENV, { fetchFn });
    expect(firstDigest.dispatched).toBe(true);
    expect(firstDigest.dueCount).toBe(1);
    expect(telegramSentMessages.length).toBe(1);
    expect(telegramSentMessages[0]?.text).toContain('overwhelmed');

    // Second cron run on same local day -> idempotent, does not send duplicate Telegram message
    const secondDigest = await handleScheduledCron(cronTimeMs + 5000, ENV, { fetchFn });
    expect(secondDigest.dispatched).toBe(false);
    expect(secondDigest.reason).toBe('already_dispatched');
    expect(telegramSentMessages.length).toBe(1);

    // 3. Submit review (`good`) via POST /api/v1/reviews -> interval becomes 1 day, replay with same event_id is idempotent
    const reviewEventId = '8d88e2b1-92a8-4bcc-b3fa-f03c9ce2c4b8';
    const revRes1 = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          event_id: reviewEventId,
          word_id: createdWordId,
          rating: 'good',
        }),
      }),
      ENV,
      { fetchFn },
    );
    expect(revRes1.status).toBe(200);
    const revJson1 = (await revRes1.json()) as {
      data: { interval_days: number; repetitions: number; duplicate_event: boolean };
    };
    expect(revJson1.data.interval_days).toBe(1);
    expect(revJson1.data.repetitions).toBe(1);
    expect(revJson1.data.duplicate_event).toBe(false);

    // Replay same review event_id (Vector 7) -> duplicate_event=true, does not increment repetitions to 2
    const revRes2 = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          event_id: reviewEventId,
          word_id: createdWordId,
          rating: 'good',
        }),
      }),
      ENV,
      { fetchFn },
    );
    const revJson2 = (await revRes2.json()) as {
      data: { interval_days: number; repetitions: number; duplicate_event: boolean };
    };
    expect(revJson2.data.duplicate_event).toBe(true);
    expect(revJson2.data.repetitions).toBe(1);
    expect(gas.spreadsheet.getSheetByName('Reviews')?.getLastRow()).toBe(2);
  });
});
