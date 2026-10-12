import { describe, expect, it } from 'vitest';
import { createGasRuntimeHarness, type InMemorySheet } from './gas-runtime-harness.js';
import { GasRepositoryAdapter } from '../apps/worker/src/adapters/gas-client.js';
import { handleWorkerRequest } from '../apps/worker/src/entry.js';
import { TelegramBotClient } from '../apps/worker/src/adapters/telegram-bot-client.js';

const USER = 'telegram:123';
const NOW = '2026-10-12T18:30:00.000Z';
function setup() {
  const props = {
    SHEET_ID: 'synthetic',
    GAS_SHARED_SECRET: 'synthetic-fsrs-regression',
    OWNER_USER_ID: USER,
  };
  const gas = createGasRuntimeHarness(props);
  gas.setupSheets();
  const fetchFn: typeof fetch = async (_url, init) =>
    new Response(gas.doPost(String(init?.body)).bodyText);
  const repo = new GasRepositoryAdapter(
    'https://gas.example/exec',
    props.GAS_SHARED_SECRET,
    fetchFn,
  );
  return { gas, repo, props, fetchFn };
}
function setCell(sheet: InMemorySheet, name: string, value: unknown, row = 2) {
  sheet.getRange(row, sheet.rows[0]!.indexOf(name) + 1).setValue(value);
}
async function word(repo: GasRepositoryAdapter, suffix = '001') {
  return repo.upsert(USER, 'request-create', {
    event_id: `fsrs_create_${suffix}`,
    word: `bank${suffix}`,
    part_of_speech: 'noun',
    sense_key: 'default',
    meaning_vi: 'ngân hàng',
    example: '',
    source_excerpt: '',
  });
}
describe('M5-06 FSRS production regressions', () => {
  it('targets an independent Telegram Card without relying on its ID prefix', async () => {
    const { gas, repo, fetchFn } = setup();
    const w = await word(repo);
    const cards = gas.spreadsheet.getSheetByName('Cards')!;
    const second = [...cards.rows[1]!];
    second[cards.rows[0]!.indexOf('card_id')] = 'reverse_bank';
    cards.appendRow(second);
    const callback = TelegramBotClient.buildQuizKeyboard('reverse_bank', 1)[0]![0]!.callback_data!;
    const response = await handleWorkerRequest(
      new Request('https://worker.example/telegram/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'synthetic-webhook',
        },
        body: JSON.stringify({
          update_id: 98765,
          callback_query: { id: 'callback98765', from: { id: 123 }, data: callback },
        }),
      }),
      {
        GEMINI_API_KEY: 'synthetic-unused',
        OWNER_TELEGRAM_ID: '123',
        TELEGRAM_WEBHOOK_SECRET: 'synthetic-webhook',
        TELEGRAM_BOT_TOKEN: 'synthetic-bot',
        GAS_EXEC_URL: 'https://gas.example/exec',
        GAS_SHARED_SECRET: 'synthetic-fsrs-regression',
      },
      {
        fetchFn: async (url, init) =>
          String(url).includes('api.telegram.org')
            ? new Response('{"ok":true}')
            : fetchFn(url, init),
      },
    );
    expect(response.status).toBe(200);
    expect((await repo.getCard(USER, 'request-default', `c_${w.word_id}`)).reps).toBe(0);
    expect((await repo.getCard(USER, 'request-reverse', 'reverse_bank')).reps).toBe(1);
  });
  it('accepts official Relearning while mapping legacy review_state to learning', async () => {
    const { gas, repo } = setup();
    const w = await word(repo);
    const cards = gas.spreadsheet.getSheetByName('Cards')!;
    for (const [key, val] of Object.entries({
      state: 'Review',
      stability: 5,
      difficulty: 5,
      reps: 3,
      last_review_at_utc: '2026-10-10T00:00:00.000Z',
    }))
      setCell(cards, key, val);
    const result = await repo.recordReview(
      USER,
      'request-review',
      {
        event_id: 'fsrs_review_relearning',
        card_id: `c_${w.word_id}`,
        rating: 'again',
        expected_version: 1,
      },
      NOW,
    );
    expect(result.state).toBe('Relearning');
    expect(result.review_state).toBe('learning');
    expect((await repo.listDue(USER, 'request-due', 50)).items).toBeDefined();
  });
  it('checks Card row_version exclusively, never substitutes Word version', async () => {
    const { gas, repo } = setup();
    const w = await word(repo);
    setCell(gas.spreadsheet.getSheetByName('Words')!, 'version', 7);
    await expect(
      repo.recordReview(
        USER,
        'request-stale',
        {
          event_id: 'fsrs_stale_version',
          card_id: `c_${w.word_id}`,
          rating: 'good',
          expected_version: 7,
        },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(gas.spreadsheet.getSheetByName('Reviews')!.getLastRow()).toBe(1);
  });
  it('rejects changed expected_version on the same event while replaying the original result', async () => {
    const { repo } = setup();
    const w = await word(repo);
    const input = {
      event_id: 'fsrs_review_replay',
      card_id: `c_${w.word_id}`,
      rating: 'good' as const,
      expected_version: 1,
    };
    const result = await repo.recordReview(USER, 'request-one', input, NOW);
    expect(
      await repo.recordReview(USER, 'request-retry', input, '2026-10-12T18:31:00.000Z'),
    ).toMatchObject({
      review_id: result.review_id,
      row_version: result.row_version,
      duplicate_event: true,
    });
    await expect(
      repo.recordReview(USER, 'request-changed', { ...input, expected_version: 2 }, NOW),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('dry-run migration changes no tabs, headers, rows or properties on real v1 layout', async () => {
    const { gas, props } = setup();
    for (const name of ['Cards', 'Settings'])
      gas.spreadsheet.deleteSheet(gas.spreadsheet.getSheetByName(name)!);
    gas.spreadsheet.getSheetByName('Reviews')!.rows[0] = [
      'review_id',
      'event_id',
      'user_id',
      'word_id',
      'rating',
      'reviewed_at',
      'old_due_at',
      'new_due_at',
      'old_interval_days',
      'new_interval_days',
    ];
    gas.spreadsheet.getSheetByName('Events')!.rows[0]!.pop();
    gas.spreadsheet.getSheetByName('DailyDispatchLog')!.rows[0]!.pop();
    const names = ['Words', 'Cards', 'Settings', 'Events', 'Reviews', 'Users', 'DailyDispatchLog'];
    const snapshot = () =>
      JSON.stringify({ sheets: names.map((name) => gas.spreadsheet.getSheetByName(name)), props });
    const before = snapshot();
    gas.migrateSchemaV3(true);
    expect(snapshot()).toBe(before);
    gas.migrateSchemaV3(false);
    expect(gas.spreadsheet.getSheetByName('Events')!.rows[0]).toContain('result_json');
    expect(gas.spreadsheet.getSheetByName('DailyDispatchLog')!.rows[0]).toContain('claim_token');
  });
  it('does not hide unmigrated Words when Cards exists but is only partially populated', async () => {
    const { gas, repo } = setup();
    await word(repo, '001');
    const second = await word(repo, '002');
    gas.spreadsheet.getSheetByName('Cards')!.rows.pop();
    expect(
      (await repo.listDue(USER, 'request-partial', 50)).items.map((card) => card.word_id),
    ).toContain(second.word_id);
  });
  it('applies validated Settings configuration to scheduler and rejects malformed settings', async () => {
    const { gas, repo } = setup();
    const w = await word(repo);
    const settings = gas.spreadsheet.getSheetByName('Settings')!;
    settings.appendRow(
      settings.rows[0]!.map(
        (key) =>
          ({
            user_id: USER,
            desired_retention: 0.99,
            maximum_interval: 100,
            timezone: 'Asia/Ho_Chi_Minh',
            scheduler_parameters_json: '{}',
          })[String(key) as 'user_id'] ?? '',
      ),
    );
    const high = await repo.preview(USER, 'request-high', w.word_id, NOW);
    setCell(settings, 'desired_retention', 0.7);
    const low = await repo.preview(USER, 'request-low', w.word_id, NOW);
    expect(low.preview.easy.interval_days).toBeGreaterThan(high.preview.easy.interval_days);
    setCell(settings, 'desired_retention', 2);
    await expect(repo.preview(USER, 'request-invalid', w.word_id, NOW)).rejects.toThrow();
  });
  it('counts reviews by UTC+7 local day and excludes deleted Words from active statistics', async () => {
    const { repo } = setup();
    const w = await word(repo);
    await repo.recordReview(
      USER,
      'request-review',
      { event_id: 'fsrs_midnight_review', word_id: w.word_id, rating: 'good', expected_version: 1 },
      '2026-10-12T16:30:00.000Z',
    );
    expect((await repo.getStats(USER, 'request-stats', NOW)).completed_today).toBe(0);
    await repo.softDelete(USER, 'request-delete', w.word_id, 'fsrs_delete_for_stats');
    expect((await repo.getStats(USER, 'request-stats2', NOW)).total_active_cards).toBe(0);
    await expect(repo.preview(USER, 'request-deleted', `c_${w.word_id}`, NOW)).rejects.toThrow();
  });
  it('replays acknowledged scheduling after deletion without needing a live Card or config', async () => {
    const { repo, gas } = setup();
    const w = await word(repo);
    const input = {
      event_id: 'fsrs_retry_deleted',
      card_id: `c_${w.word_id}`,
      rating: 'good' as const,
      expected_version: 1,
    };
    const result = await repo.recordReview(USER, 'request-review', input, NOW);
    await repo.softDelete(USER, 'request-delete', w.word_id, 'fsrs_delete_for_retry');
    expect(await repo.recordReview(USER, 'request-retry', input, NOW)).toMatchObject({
      review_id: result.review_id,
      duplicate_event: true,
    });
    expect(gas.spreadsheet.getSheetByName('Reviews')!.getLastRow()).toBe(2);
  });
  it('rejects one of two concurrent ratings of the same Card version', async () => {
    const { repo, gas } = setup();
    const w = await word(repo);
    const outcomes = await Promise.allSettled(
      ['good', 'easy'].map((rating, index) =>
        repo.recordReview(
          USER,
          `request-race-${index}`,
          {
            event_id: `fsrs_race_event_${index}`,
            card_id: `c_${w.word_id}`,
            expected_version: 1,
            rating: rating as 'good' | 'easy',
          },
          NOW,
        ),
      ),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(gas.spreadsheet.getSheetByName('Reviews')!.getLastRow()).toBe(2);
  });
  it('requires reconciliation when a Review exists without its original Events snapshot', async () => {
    const { repo, gas } = setup();
    const w = await word(repo);
    const input = {
      event_id: 'fsrs_partial_commit',
      card_id: `c_${w.word_id}`,
      rating: 'good' as const,
    };
    await repo.recordReview(USER, 'request-first', input, NOW);
    gas.spreadsheet.getSheetByName('Events')!.rows.pop();
    await expect(repo.recordReview(USER, 'request-retry', input, NOW)).rejects.toMatchObject({
      status: 409,
    });
    expect(gas.spreadsheet.getSheetByName('Reviews')!.getLastRow()).toBe(2);
  });
  it('retains native FSRS audit fields and full before/after Card snapshots', async () => {
    const { repo, gas } = setup();
    const w = await word(repo);
    await repo.recordReview(
      USER,
      'request-log',
      {
        event_id: 'fsrs_review_native_log',
        card_id: `c_${w.word_id}`,
        expected_version: 1,
        rating: 'good',
      },
      NOW,
    );
    const reviews = gas.spreadsheet.getSheetByName('Reviews')!;
    const cell = (column: string) => reviews.rows[1]![reviews.rows[0]!.indexOf(column)];
    expect(JSON.parse(String(cell('review_log_json')))).toMatchObject({
      rating: 3,
      state: 0,
      review: NOW,
      learning_steps: 0,
    });
    expect(JSON.parse(String(cell('previous_card_json'))).row_version).toBe(1);
    expect(JSON.parse(String(cell('next_card_json'))).row_version).toBe(2);
    expect(cell('previous_version')).toBe(1);
    expect(cell('next_version')).toBe(2);
  });
  it('preserves legacy due/counts and suspension while initializing memory through official FSRS on first rating', async () => {
    const { gas, repo } = setup();
    const w = await word(repo);
    gas.spreadsheet.getSheetByName('Cards')!.rows.pop();
    const words = gas.spreadsheet.getSheetByName('Words')!;
    setCell(words, 'review_state', 'suspended');
    setCell(words, 'due_at', NOW);
    setCell(words, 'repetitions', 9);
    gas.migrateSchemaV3(false);
    const cards = gas.spreadsheet.getSheetByName('Cards')!;
    expect(cards.rows[1]![cards.rows[0]!.indexOf('is_suspended')]).toBe(true);
    expect(cards.rows[1]![cards.rows[0]!.indexOf('due_at_utc')]).toBe(NOW);
    expect(
      JSON.parse(String(cards.rows[1]![cards.rows[0]!.indexOf('legacy_snapshot_json')]))
        .repetitions,
    ).toBe(9);
    setCell(words, 'review_state', 'review');
    setCell(cards, 'is_suspended', false);
    const result = await repo.recordReview(
      USER,
      'request-imported',
      {
        event_id: 'fsrs_imported_review',
        card_id: `c_${w.word_id}`,
        expected_version: 1,
        rating: 'good',
      },
      NOW,
    );
    expect(result.stability).toBeGreaterThan(0);
    expect(result.reps).toBe(10);
  });
});
