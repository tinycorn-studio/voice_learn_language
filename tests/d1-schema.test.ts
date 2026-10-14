// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';
import {
  clearGuard,
  requireD1Schema,
  writeGuard,
} from '../apps/worker/src/adapters/d1-database.js';
import { createRepositories } from '../apps/worker/src/adapters/repository-factory.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';

const runtimes: Awaited<ReturnType<typeof createD1RuntimeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});
async function setup() {
  const runtime = await createD1RuntimeHarness();
  runtimes.push(runtime);
  return runtime.db;
}

it('runs D1 schema and rolls back the entire batch on a failed SQL guard or maintenance', async () => {
  const db = await setup();
  await requireD1Schema(db);
  await expect(
    db.batch([
      db.prepare("INSERT INTO users VALUES ('synthetic','{}')"),
      writeGuard(db, 'synthetic-guard', '0=1'),
    ]),
  ).rejects.toThrow();
  expect(await db.prepare('SELECT * FROM users').all()).toMatchObject({ results: [] });
  await db.batch([writeGuard(db, 'synthetic-guard'), clearGuard(db, 'synthetic-guard')]);
  await db.prepare("UPDATE system_state SET value='false' WHERE key='writes_enabled'").run();
  await expect(db.batch([writeGuard(db, 'maintenance')])).rejects.toThrow();
  expect((await db.prepare('SELECT * FROM mutation_guards').all()).results).toHaveLength(0);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
});

it('fails closed with missing D1 binding instead of falling back to GAS', async () => {
  const env: WorkerEnv = {
    GEMINI_API_KEY: 'synthetic',
    TELEGRAM_BOT_TOKEN: 'synthetic',
    TELEGRAM_WEBHOOK_SECRET: 'synthetic',
    OWNER_TELEGRAM_ID: '123',
    GAS_EXEC_URL: 'https://synthetic.invalid',
    GAS_SHARED_SECRET: 'synthetic',
    DATA_BACKEND: 'd1',
  };
  await expect(createRepositories(env, fetch)).rejects.toMatchObject({ status: 503 });
});

it('enforces ownership, JSON/index parity, unique word keys and append-only Reviews in D1', async () => {
  const db = await setup();
  const word = {
    word_id: 'w_test',
    user_id: 'telegram:123',
    word_key: 'synthetic-key',
    version: 1,
    deleted_at: '',
  };
  const card = {
    card_id: 'c_test',
    user_id: word.user_id,
    word_id: word.word_id,
    due_at_utc: '2026-10-13T00:00:00.000Z',
    state: 'New',
    row_version: 1,
    is_suspended: false,
  };
  await db
    .prepare('INSERT INTO words VALUES (?,?,?,?,?,?,?)')
    .bind(word.word_id, word.user_id, word.word_key, card.due_at_utc, '', 1, JSON.stringify(word))
    .run();
  await expect(
    db
      .prepare('INSERT INTO words VALUES (?,?,?,?,?,?,?)')
      .bind(
        'w_other',
        word.user_id,
        word.word_key,
        card.due_at_utc,
        '',
        1,
        JSON.stringify({ ...word, word_id: 'w_other' }),
      )
      .run(),
  ).rejects.toThrow();
  await db
    .prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?)')
    .bind(
      card.card_id,
      card.user_id,
      card.word_id,
      card.due_at_utc,
      card.state,
      0,
      1,
      JSON.stringify(card),
    )
    .run();
  await expect(
    db.prepare("UPDATE cards SET row_version=2 WHERE card_id='c_test'").run(),
  ).rejects.toThrow();
  await expect(
    db
      .prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?)')
      .bind(
        'c_foreign',
        'telegram:999',
        card.word_id,
        card.due_at_utc,
        card.state,
        0,
        1,
        JSON.stringify({ ...card, card_id: 'c_foreign', user_id: 'telegram:999' }),
      )
      .run(),
  ).rejects.toThrow();
  const review = {
    review_id: 'r_test',
    event_id: 'event_test',
    user_id: word.user_id,
    card_id: card.card_id,
    word_id: word.word_id,
    reviewed_at: card.due_at_utc,
  };
  await db
    .prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(
      review.event_id,
      word.user_id,
      'review.record',
      review.review_id,
      review.reviewed_at,
      'synthetic-hash',
      'd1-hmac-v1',
      '{}',
      '{}',
    )
    .run();
  await db
    .prepare('INSERT INTO reviews VALUES (?,?,?,?,?,?,?)')
    .bind(
      review.review_id,
      review.event_id,
      review.user_id,
      review.card_id,
      review.word_id,
      review.reviewed_at,
      JSON.stringify(review),
    )
    .run();
  await expect(db.prepare("DELETE FROM reviews WHERE review_id='r_test'").run()).rejects.toThrow();
  await expect(
    db.prepare("UPDATE reviews SET reviewed_at='changed' WHERE review_id='r_test'").run(),
  ).rejects.toThrow();
});
