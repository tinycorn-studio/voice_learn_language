// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';
import { D1RepositoryAdapter } from '../apps/worker/src/adapters/d1-repository.js';
import { GasRepositoryAdapter } from '../apps/worker/src/adapters/gas-client.js';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';

const USER = 'telegram:123';
const NOW = '2026-10-13T11:00:00.000Z';
const KEY = 'synthetic-secret';
const WORD = {
  event_id: 'd1-create-word-001',
  word: 'bank',
  lemma: 'bank',
  part_of_speech: 'noun' as const,
  sense_key: 'financial',
  meaning_vi: 'ngân hàng',
  example: '',
  source_excerpt: 'What does bank mean?',
};
const runtimes: Awaited<ReturnType<typeof createD1RuntimeHarness>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});
async function setup() {
  const runtime = await createD1RuntimeHarness();
  runtimes.push(runtime);
  const repo = new D1RepositoryAdapter(runtime.db, KEY, () => NOW);
  return { ...runtime, repo };
}
describe('D1 authoritative repository', () => {
  it('batches create and review preflight reads before their atomic mutation batches', async () => {
    const { db } = await setup();
    const batchSizes: number[] = [];
    const repo = new D1RepositoryAdapter(
      {
        prepare: (sql) => db.prepare(sql),
        batch: (statements) => {
          batchSizes.push(statements.length);
          return db.batch(statements);
        },
      },
      KEY,
      () => NOW,
    );

    const created = await repo.upsert(USER, 'create-batched', WORD);
    expect(batchSizes).toHaveLength(2);
    expect(batchSizes[0]).toBe(2);
    expect(batchSizes[1]).toBeGreaterThan(2);

    batchSizes.length = 0;
    await repo.recordReview(
      USER,
      'review-batched',
      {
        event_id: 'd1-batched-review-001',
        card_id: `c_${created.word_id}`,
        rating: 'good',
        expected_version: 1,
      },
      NOW,
    );
    expect(batchSizes).toHaveLength(2);
    expect(batchSizes[0]).toBe(2);
    expect(batchSizes[1]).toBeGreaterThan(2);
  });

  it('uses Settings in the official scheduler, preserves Hard recall and rejects malformed config', async () => {
    const { db, repo } = await setup();
    const created = await repo.upsert(USER, 'create', WORD);
    const context = await repo.getCardContext(USER, created.word_id);
    const base = {
      ...context.card,
      state: 'Review' as const,
      stability: 5,
      difficulty: 5,
      reps: 3,
      lapses: 1,
      last_review_at_utc: '2026-10-12T11:00:00.000Z',
      elapsed_days: 1,
      scheduled_days: 1,
    };
    await db.batch([
      repo.cardStatement(base),
      repo.cardStatement({ ...base, card_id: 'again_bank' }),
    ]);
    await db
      .prepare('INSERT INTO settings VALUES (?,?)')
      .bind(
        USER,
        JSON.stringify({
          user_id: USER,
          desired_retention: 0.95,
          maximum_interval: 100,
          parameters_version: 'test-retention-v1',
        }),
      )
      .run();
    const hard = await repo.recordReview(
      USER,
      'hard',
      {
        event_id: 'd1-hard-review-001',
        card_id: base.card_id,
        rating: 'hard',
        expected_version: 1,
      },
      NOW,
    );
    const again = await repo.recordReview(
      USER,
      'again',
      {
        event_id: 'd1-again-review-001',
        card_id: 'again_bank',
        rating: 'again',
        expected_version: 1,
      },
      NOW,
    );
    expect(hard.lapses).toBe(1);
    expect(again.lapses).toBe(2);
    expect(again.state).toBe('Relearning');
    expect((await repo.getCardContext(USER, base.card_id)).card.parameters_version).toBe(
      'test-retention-v1',
    );
    await db
      .prepare('UPDATE settings SET record_json=? WHERE user_id=?')
      .bind(JSON.stringify({ desired_retention: 4 }), USER)
      .run();
    await expect(repo.preview(USER, 'invalid', base.card_id, NOW)).rejects.toMatchObject({
      status: 502,
    });
  });
  it('atomically creates one Word/Card/Event/outbox, preserves corrections and replays CRUD after deletion', async () => {
    const { db, repo } = await setup();
    const created = await repo.upsert(USER, 'create', WORD);
    expect(await repo.upsert(USER, 'retry', WORD)).toMatchObject({
      ...created,
      duplicate_event: true,
    });
    await expect(
      repo.upsert(USER, 'changed', { ...WORD, meaning_vi: 'changed' }),
    ).rejects.toMatchObject({ status: 409 });
    let word = (await repo.list(USER, 'list', { limit: 50 })).items[0]!;
    word = await repo.update(USER, 'edit', word.word_id, {
      event_id: 'd1-update-word-001',
      version: word.version,
      meaning_vi: 'đã sửa',
    });
    await repo.upsert(USER, 'again', { ...WORD, event_id: 'd1-create-word-002' });
    expect((await repo.list(USER, 'list', { limit: 50 })).items[0]).toMatchObject({
      meaning_vi: 'đã sửa',
      times_asked: 2,
    });
    await expect(
      repo.preview('telegram:999', 'foreign', `c_${word.word_id}`, NOW),
    ).rejects.toMatchObject({ status: 404 });
    await repo.softDelete(USER, 'delete', word.word_id, 'd1-delete-word-001');
    expect((await repo.list(USER, 'list', { limit: 50 })).items).toHaveLength(0);
    expect((await repo.listDue(USER, 'due', 50)).items).toHaveLength(0);
    expect(
      await repo.update(USER, 'edit-replay', word.word_id, {
        event_id: 'd1-update-word-001',
        version: 1,
        meaning_vi: 'đã sửa',
      }),
    ).toEqual(word);
    expect(
      await repo.softDelete(USER, 'delete-replay', word.word_id, 'd1-delete-word-001'),
    ).toMatchObject({ deleted: true });
    expect((await db.prepare('SELECT * FROM cards').all()).results).toHaveLength(1);
    expect((await db.prepare('SELECT * FROM events').all()).results).toHaveLength(4);
    expect((await db.prepare('SELECT * FROM sync_outbox').all()).results).toHaveLength(4);
  });
  it('runs native FSRS, reviews independent Cards, preserves replay and counts UTC+7 stats', async () => {
    const { db, repo } = await setup();
    const created = await repo.upsert(USER, 'create', WORD);
    const first = await repo.getCardContext(USER, created.word_id);
    await db.batch([
      repo.cardStatement({ ...first.card, card_id: 'reverse_bank', card_type: 'vi_to_en' }),
    ]);
    const before = (await repo.listDue(USER, 'due', 50)).items;
    expect(before).toHaveLength(2);
    const preview = await repo.preview(USER, 'preview', first.card.card_id, NOW);
    const input = {
      event_id: 'd1-review-event-001',
      card_id: first.card.card_id,
      rating: 'good' as const,
      expected_version: 1,
    };
    const result = await repo.recordReview(USER, 'review', input, NOW);
    expect(result.next_due_at).toBe(preview.preview.good.next_due_at);
    expect((await repo.getCardContext(USER, 'reverse_bank')).card.reps).toBe(0);
    expect(await repo.getStats(USER, 'stats', NOW)).toMatchObject({
      total_active_cards: 2,
      completed_today: 1,
      total_reviews_count: 1,
    });
    const audit = (await db
      .prepare('SELECT record_json FROM reviews')
      .first<{ record_json: string }>())!;
    const row = JSON.parse(audit.record_json) as {
      previous_card_json: string;
      next_card_json: string;
      review_log_json: string;
    };
    expect(JSON.parse(row.previous_card_json)).toMatchObject({ row_version: 1, reps: 0 });
    expect(JSON.parse(row.next_card_json)).toMatchObject({ row_version: 2, reps: 1 });
    expect(JSON.parse(row.review_log_json)).toMatchObject({ rating: 3, state: 0 });
    await repo.softDelete(USER, 'delete', created.word_id, 'd1-delete-word-001');
    expect(await repo.recordReview(USER, 'retry', input, '2026-10-14T11:00:00.000Z')).toMatchObject(
      { ...result, duplicate_event: true, idempotent_replay: true },
    );
    await expect(
      repo.recordReview(USER, 'changed', { ...input, rating: 'easy' }, NOW),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('allows one of two concurrent ratings of the same version and one concurrent identical event', async () => {
    const { db, repo } = await setup();
    const created = await repo.upsert(USER, 'create', WORD);
    const base = { card_id: `c_${created.word_id}`, rating: 'hard' as const, expected_version: 1 };
    const ratings = await Promise.allSettled([
      repo.recordReview(USER, 'one', { ...base, event_id: 'd1-rating-first-001' }, NOW),
      repo.recordReview(USER, 'two', { ...base, event_id: 'd1-rating-other-001' }, NOW),
    ]);
    expect(ratings.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(1);
    const next = { ...base, expected_version: 2, event_id: 'd1-rating-shared-001' };
    const identical = await Promise.all([
      repo.recordReview(USER, 'three', next, NOW),
      repo.recordReview(USER, 'four', next, NOW),
    ]);
    expect(identical[0]!.review_id).toBe(identical[1]!.review_id);
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(2);
    expect((await db.prepare('SELECT * FROM mutation_guards').all()).results).toHaveLength(0);
  });
  it('rolls back Card, Word, Event and outbox when an audit insert fails mid-batch', async () => {
    const { db, repo } = await setup();
    const created = await repo.upsert(USER, 'create', WORD);
    await db
      .prepare(
        "CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
      )
      .run();
    await expect(
      repo.recordReview(
        USER,
        'broken',
        {
          event_id: 'd1-broken-review-001',
          card_id: `c_${created.word_id}`,
          rating: 'good',
          expected_version: 1,
        },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await repo.getCardContext(USER, created.word_id)).card).toMatchObject({
      row_version: 1,
      reps: 0,
    });
    expect((await db.prepare('SELECT * FROM events').all()).results).toHaveLength(1);
    expect((await db.prepare('SELECT * FROM sync_outbox').all()).results).toHaveLength(1);
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(0);
  });
  it('replays an imported GAS HMAC Event before reading missing/deleted mutable entities', async () => {
    const { db, repo } = await setup();
    const gas = createGasRuntimeHarness({
      SHEET_ID: 'synthetic',
      GAS_SHARED_SECRET: KEY,
      OWNER_USER_ID: USER,
    });
    gas.setupSheets();
    const legacy = new GasRepositoryAdapter(
      'https://synthetic.invalid',
      KEY,
      async (_url, init) => new Response(gas.doPost(String(init?.body)).bodyText),
    );
    const result = await legacy.upsert(USER, 'legacy', WORD);
    const sheet = gas.spreadsheet.getSheetByName('Events')!;
    const event = Object.fromEntries(
      sheet.rows[0]!.map((key, index) => [String(key), sheet.rows[1]![index]]),
    ) as Record<string, unknown>;
    await db
      .prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(
        event['event_id'],
        event['user_id'],
        event['event_type'],
        event['entity_id'],
        event['occurred_at'],
        event['payload_hash'],
        'gas-hmac-v1',
        event['result_json'],
        JSON.stringify(event),
      )
      .run();
    expect(await repo.upsert(USER, 'after-cutover', WORD)).toEqual({
      ...result,
      duplicate_event: true,
    });
    expect((await db.prepare('SELECT * FROM words').all()).results).toHaveLength(0);
  });
});
