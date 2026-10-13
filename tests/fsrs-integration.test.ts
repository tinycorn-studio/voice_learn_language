import { describe, expect, it } from 'vitest';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';
import { GasRepositoryAdapter } from '../apps/worker/src/adapters/gas-client.js';
import { handleWorkerRequest } from '../apps/worker/src/entry.js';
import { issueSessionToken } from '../apps/worker/src/auth/telegram-auth.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';

const ENV: WorkerEnv = {
  GEMINI_API_KEY: 'test-gemini-key',
  TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  OWNER_TELEGRAM_ID: '777888999',
  SESSION_SIGNING_SECRET: 'test-session-secret-at-least-32-chars-long',
  GAS_SHARED_SECRET: 'synthetic-fsrs-secret',
  GAS_EXEC_URL: 'https://gas.example/exec',
};

function setupHarness() {
  const gas = createGasRuntimeHarness({
    SHEET_ID: 'synthetic-fsrs-sheet',
    GAS_SHARED_SECRET: ENV.GAS_SHARED_SECRET,
    OWNER_USER_ID: `telegram:${ENV.OWNER_TELEGRAM_ID}`,
  });
  gas.setupSheets();

  const fetchFn: typeof fetch = async (_url, init) => {
    const postBody = String(init?.body ?? '');
    const res = gas.doPost(postBody);
    return new Response(res.bodyText, { status: res.status });
  };

  const repo = new GasRepositoryAdapter(ENV.GAS_EXEC_URL, ENV.GAS_SHARED_SECRET, fetchFn);

  return { gas, fetchFn, repo };
}

describe('FSRS End-to-End Integration Suite', () => {
  it('M4-FSRS-01: Word upsertion creates matching initial FSRS Card with state New, stability 0, difficulty 0', async () => {
    const { repo, gas } = setupHarness();
    const userId = `telegram:${ENV.OWNER_TELEGRAM_ID}`;

    const upsertRes = await repo.upsert(userId, 'req-01', {
      event_id: 'ev_create_fsrs_word_01',
      word: 'perseverance',
      part_of_speech: 'noun',
      sense_key: 'persistence',
      meaning_vi: 'sự kiên trì, bền chí',
      example: 'Success requires perseverance.',
      source_excerpt: 'What does perseverance mean?',
    });

    expect(upsertRes.word_id).toBeTruthy();
    expect(upsertRes.created).toBe(true);

    const cardsSheet = gas.spreadsheet.getSheetByName('Cards')!;
    expect(cardsSheet.getLastRow()).toBe(2);

    const card = await repo.getCard(userId, 'req-get-card', upsertRes.word_id);
    expect(card.card_id).toBe(`c_${upsertRes.word_id}`);
    expect(card.word_id).toBe(upsertRes.word_id);
    expect(card.state).toBe('New');
    expect(card.stability).toBe(0);
    expect(card.difficulty).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.row_version).toBe(1);
    expect(card.scheduler_version).toBe('not-yet-scheduled');
  });

  it('M4-FSRS-02: Lists due cards and previews 4 rating outcomes (Again, Hard, Good, Easy) using official ts-fsrs', async () => {
    const { repo, fetchFn } = setupHarness();
    const userId = `telegram:${ENV.OWNER_TELEGRAM_ID}`;

    const session = await issueSessionToken({
      userId,
      signingSecret: ENV.SESSION_SIGNING_SECRET!,
    });
    const authHeaders = {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    };

    // 1. Create a word
    const word = await repo.upsert(userId, 'req-02', {
      event_id: 'ev_create_fsrs_word_02',
      word: 'articulate',
      part_of_speech: 'verb',
      sense_key: 'express_clearly',
      meaning_vi: 'diễn đạt rõ ràng',
      example: 'She could articulate her ideas well.',
      source_excerpt: 'She could articulate her ideas.',
    });
    expect(word.created).toBe(true);

    // 2. Query due list via worker API
    const dueRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews/due?limit=10', {
        method: 'GET',
        headers: authHeaders,
      }),
      ENV,
      { fetchFn },
    );
    expect(dueRes.status).toBe(200);
    const dueJson = (await dueRes.json()) as {
      ok: boolean;
      data: { items: Array<{ card_id: string; word: string }> };
    };
    expect(dueJson.data.items).toHaveLength(1);
    expect(dueJson.data.items[0]?.word).toBe('articulate');
    const cardId = dueJson.data.items[0]!.card_id;

    // 3. Query preview via worker API
    const previewRes = await handleWorkerRequest(
      new Request(`https://worker.example/api/v1/reviews/${encodeURIComponent(cardId)}/preview`, {
        method: 'GET',
        headers: authHeaders,
      }),
      ENV,
      { fetchFn },
    );
    expect(previewRes.status).toBe(200);
    const previewJson = (await previewRes.json()) as {
      ok: boolean;
      data: {
        card_id: string;
        preview: {
          again: { rating: string; next_due_at: string; interval_days: number };
          hard: { rating: string; next_due_at: string; interval_days: number };
          good: { rating: string; next_due_at: string; interval_days: number };
          easy: { rating: string; next_due_at: string; interval_days: number };
        };
      };
    };

    expect(previewJson.data.card_id).toBe(cardId);
    expect(previewJson.data.preview.again.rating).toBe('again');
    expect(previewJson.data.preview.hard.rating).toBe('hard');
    expect(previewJson.data.preview.good.rating).toBe('good');
    expect(previewJson.data.preview.easy.rating).toBe('easy');
    expect(Date.parse(previewJson.data.preview.again.next_due_at)).toBeGreaterThan(0);
    expect(Date.parse(previewJson.data.preview.easy.next_due_at)).toBeGreaterThan(0);
  });

  it('M4-FSRS-03: Submitting rating updates card, creates append-only review log, and handles idempotent replay', async () => {
    const { repo, fetchFn, gas } = setupHarness();
    const userId = `telegram:${ENV.OWNER_TELEGRAM_ID}`;

    const session = await issueSessionToken({
      userId,
      signingSecret: ENV.SESSION_SIGNING_SECRET!,
    });
    const authHeaders = {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    };

    const word = await repo.upsert(userId, 'req-03', {
      event_id: 'ev_create_fsrs_word_03',
      word: 'meticulous',
      part_of_speech: 'adjective',
      sense_key: 'careful',
      meaning_vi: 'tỉ mỉ, cẩn thận',
      example: 'He is meticulous about his work.',
      source_excerpt: 'He is meticulous.',
    });

    const submitEventId = 'ev_submit_review_01';
    const subRes1 = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews/submit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          event_id: submitEventId,
          word_id: word.word_id,
          rating: 'good',
        }),
      }),
      ENV,
      { fetchFn },
    );

    expect(subRes1.status).toBe(200);
    const subJson1 = (await subRes1.json()) as {
      ok: boolean;
      data: {
        card_id: string;
        reps: number;
        stability: number;
        difficulty: number;
        row_version: number;
        duplicate_event: boolean;
      };
    };

    expect(subJson1.data.reps).toBe(1);
    expect(subJson1.data.stability).toBeGreaterThan(0);
    expect(subJson1.data.difficulty).toBeGreaterThan(0);
    expect(subJson1.data.row_version).toBe(2);
    expect(subJson1.data.duplicate_event).toBe(false);

    // Verify Reviews tab contains append-only entry with review_log_json
    const reviewsSheet = gas.spreadsheet.getSheetByName('Reviews')!;
    expect(reviewsSheet.getLastRow()).toBe(2);

    // Verify idempotent replay: same event_id does not re-apply review or increment version
    const subRes2 = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews/submit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          event_id: submitEventId,
          word_id: word.word_id,
          rating: 'good',
        }),
      }),
      ENV,
      { fetchFn },
    );

    expect(subRes2.status).toBe(200);
    const subJson2 = (await subRes2.json()) as {
      ok: boolean;
      data: { duplicate_event: boolean; reps: number };
    };
    expect(subJson2.data.duplicate_event).toBe(true);
    expect(subJson2.data.reps).toBe(1);
    expect(reviewsSheet.getLastRow()).toBe(2);
  });

  it('M4-FSRS-04: Confirms Hard rating does NOT increment lapses or treat recall as failure', async () => {
    const { repo, fetchFn } = setupHarness();
    const userId = `telegram:${ENV.OWNER_TELEGRAM_ID}`;

    const session = await issueSessionToken({
      userId,
      signingSecret: ENV.SESSION_SIGNING_SECRET!,
    });
    const authHeaders = {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    };

    const word = await repo.upsert(userId, 'req-04', {
      event_id: 'ev_create_fsrs_word_04',
      word: 'tenacious',
      part_of_speech: 'adjective',
      sense_key: 'persistent',
      meaning_vi: 'kiên cường, dai dẳng',
      example: 'A tenacious advocate.',
      source_excerpt: 'tenacious advocate',
    });

    const res = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews/submit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          event_id: 'ev_submit_hard_rating_01',
          word_id: word.word_id,
          rating: 'hard',
        }),
      }),
      ENV,
      { fetchFn },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { lapses: number; reps: number; stability: number };
    };
    expect(json.data.lapses).toBe(0); // MUST NEVER be treated as failed recall
    expect(json.data.reps).toBe(1);
    expect(json.data.stability).toBeGreaterThan(0);
  });

  it('M4-FSRS-05: Returns accurate review stats (new, learning, review, due_today, completed_today)', async () => {
    const { repo, fetchFn } = setupHarness();
    const userId = `telegram:${ENV.OWNER_TELEGRAM_ID}`;

    const session = await issueSessionToken({
      userId,
      signingSecret: ENV.SESSION_SIGNING_SECRET!,
    });
    const authHeaders = {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    };

    // Upsert 2 words
    const w1 = await repo.upsert(userId, 'req-s1', {
      event_id: 'ev_stats_word_1',
      word: 'diligent',
      part_of_speech: 'adjective',
      sense_key: 'hardworking',
      meaning_vi: 'chăm chỉ',
      example: '',
      source_excerpt: '',
    });
    await repo.upsert(userId, 'req-s2', {
      event_id: 'ev_stats_word_2',
      word: 'pragmatic',
      part_of_speech: 'adjective',
      sense_key: 'practical',
      meaning_vi: 'thực tế',
      example: '',
      source_excerpt: '',
    });

    // Review one word
    await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews/submit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          event_id: 'ev_stats_review_w1',
          word_id: w1.word_id,
          rating: 'good',
        }),
      }),
      ENV,
      { fetchFn },
    );

    // Query stats
    const statsRes = await handleWorkerRequest(
      new Request('https://worker.example/api/v1/reviews/stats', {
        method: 'GET',
        headers: authHeaders,
      }),
      ENV,
      { fetchFn },
    );

    expect(statsRes.status).toBe(200);
    const statsJson = (await statsRes.json()) as {
      ok: boolean;
      data: {
        new_cards: number;
        completed_today: number;
        total_active_cards?: number;
      };
    };

    expect(statsJson.data.new_cards).toBe(1);
    expect(statsJson.data.completed_today).toBe(1);
  });

  it('M4-FSRS-06: Schema V3 migration creates Cards tab and migrates existing Words without duplicate keys', async () => {
    const gas = createGasRuntimeHarness({
      SHEET_ID: 'synthetic-migration-sheet',
      GAS_SHARED_SECRET: ENV.GAS_SHARED_SECRET,
      OWNER_USER_ID: `telegram:${ENV.OWNER_TELEGRAM_ID}`,
    });
    // Setup legacy sheets (Words, Events, Reviews, Users, DailyDispatchLog)
    gas.setupSheets();

    // Populate Words with legacy row
    const words = gas.spreadsheet.getSheetByName('Words')!;
    words.appendRow([
      'w_legacy_01',
      `telegram:${ENV.OWNER_TELEGRAM_ID}`,
      `telegram:${ENV.OWNER_TELEGRAM_ID}|legacy|noun|past`,
      'legacy',
      'legacy',
      'noun',
      'past',
      'di sản',
      '',
      '',
      '',
      new Date().toISOString(),
      new Date().toISOString(),
      1,
      'learning',
      2,
      3,
      2.5,
      new Date().toISOString(),
      '',
      1,
      '',
    ]);

    // Run migration V3 (dryRun = true)
    const dryRunRes = gas.migrateSchemaV3(true);
    expect(dryRunRes.status).toBe('DRY_RUN');
    expect(dryRunRes.migrated_cards).toBe(1);

    // Run actual migration V3
    const realRes = gas.migrateSchemaV3(false);
    expect(realRes.status).toBe('APPLIED');
    expect(realRes.migrated_cards).toBe(1);

    // Running migration again is idempotent
    const secondRes = gas.migrateSchemaV3(false);
    expect(secondRes.migrated_cards).toBe(0);

    const cardsSheet = gas.spreadsheet.getSheetByName('Cards')!;
    expect(cardsSheet.getLastRow()).toBe(2);
  });
});
