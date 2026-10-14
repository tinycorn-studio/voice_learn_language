// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';
import { D1RepositoryAdapter } from '../apps/worker/src/adapters/d1-repository.js';
import {
  acceptTelegramCommand,
  processTelegramDeliveries,
  telegramMutationStatements,
} from '../apps/worker/src/adapters/telegram-delivery-store.js';
import { TelegramBotClient } from '../apps/worker/src/adapters/telegram-bot-client.js';
import {
  handleWorkerRequest,
  handleScheduledCron,
  SecurityStateStore,
} from '../apps/worker/src/entry.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';

const NOW = '2026-10-14T01:00:00.000Z';
const USER = 'telegram:123';
const ENV: WorkerEnv = {
  DATA_BACKEND: 'd1',
  GEMINI_API_KEY: 'synthetic',
  TELEGRAM_BOT_TOKEN: 'synthetic',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic',
  OWNER_TELEGRAM_ID: '123',
  GAS_SHARED_SECRET: 'synthetic',
  GAS_EXEC_URL: 'https://gas.example/exec',
};
const runtimes: Awaited<ReturnType<typeof createD1RuntimeHarness>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});
async function setup() {
  const r = await createD1RuntimeHarness();
  runtimes.push(r);
  let now = NOW;
  const repo = new D1RepositoryAdapter(r.db, ENV.GAS_SHARED_SECRET, () => now);
  const created = await repo.upsert(USER, 'create', {
    event_id: 'telegram_word_create',
    word: 'bank',
    part_of_speech: 'noun',
    sense_key: 'financial',
    meaning_vi: 'ngân hàng',
    example: '',
    source_excerpt: '',
  });
  return {
    ...r,
    repo,
    created,
    setNow: (value: string) => {
      now = value;
    },
  };
}
function webhook(update: unknown) {
  return new Request('https://worker.example/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': ENV.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify(update),
  });
}
const success: typeof fetch = async () => Response.json({ ok: true, result: { message_id: 100 } });

describe('M7-05 D1 Telegram durability', () => {
  it('commits one review and delivery across isolate retries, legacy Word keyboard and failed edits', async () => {
    const { db, repo, created } = await setup();
    const requests: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      requests.push(String(url));
      return Response.json({ ok: true });
    };
    const update = {
      update_id: 700,
      callback_query: {
        id: 'synthetic-callback',
        from: { id: 123 },
        data: `r:${created.word_id}:hard`,
        message: { message_id: 50, chat: { id: 123 } },
      },
    };
    for (let i = 0; i < 2; i++) {
      const response = await handleWorkerRequest(
        webhook(update),
        { ...ENV, DB: db },
        {
          reviewRepo: repo,
          fetchFn,
          nowMs: () => Date.parse(NOW),
        },
        new SecurityStateStore(),
      );
      expect(response.status).toBe(200);
    }
    expect(requests.every((url) => url.endsWith('/answerCallbackQuery'))).toBe(true);
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(1);
    expect((await db.prepare('SELECT * FROM telegram_updates').all()).results).toHaveLength(1);
    expect((await db.prepare('SELECT * FROM telegram_deliveries').all()).results).toHaveLength(1);
    const failing: typeof fetch = async () => {
      throw new Error('Synthetic network failure');
    };
    expect(
      await processTelegramDeliveries(db, new TelegramBotClient('synthetic', failing), NOW),
    ).toBe(0);
    const edit = vi.fn(success);
    expect(
      await processTelegramDeliveries(
        db,
        new TelegramBotClient('synthetic', edit),
        '2026-10-14T01:01:00.000Z',
      ),
    ).toBe(1);
    expect(edit).toHaveBeenCalledOnce();
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(1);
  });

  it('rolls back review, event and delivery together if the delivery insert crashes', async () => {
    const { db, repo, created } = await setup();
    await db
      .prepare(
        "CREATE TRIGGER synthetic_delivery_crash BEFORE INSERT ON telegram_deliveries BEGIN SELECT RAISE(ABORT,'synthetic crash'); END;",
      )
      .run();
    await expect(
      repo.recordReview(
        USER,
        'crash',
        { event_id: 'telegram_crash_review', word_id: created.word_id, rating: 'good' },
        NOW,
        { updateId: 701, chatId: '123', messageId: 50 },
      ),
    ).rejects.toThrow();
    expect((await repo.getCardContext(USER, created.word_id)).card.row_version).toBe(1);
    for (const table of ['reviews', 'telegram_updates', 'telegram_deliveries'])
      expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toHaveLength(0);
    expect((await db.prepare('SELECT * FROM sync_outbox').all()).results).toHaveLength(1);
  });

  it('accepts start/pause/review durably and deduplicates after restarting the webhook isolate', async () => {
    const { db, repo } = await setup();
    const fetchFn = vi.fn(success);
    for (const [id, command] of [
      [710, '/pause'],
      [711, '/start'],
      [712, '/review'],
    ] as const) {
      for (let retry = 0; retry < 2; retry++) {
        const response = await handleWorkerRequest(
          webhook({
            update_id: id,
            message: { from: { id: 123 }, chat: { id: 123 }, text: command },
          }),
          { ...ENV, DB: db },
          {
            reviewRepo: repo,
            fetchFn,
            nowMs: () => Date.parse(NOW),
          },
          new SecurityStateStore(),
        );
        expect(response.status).toBe(200);
      }
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await db.prepare('SELECT * FROM telegram_updates').all()).results).toHaveLength(3);
    expect(
      await processTelegramDeliveries(db, new TelegramBotClient('synthetic', fetchFn), NOW),
    ).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const bodies = fetchFn.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as { reply_markup?: unknown },
    );
    expect(bodies[2]?.reply_markup).toBeDefined();
    expect(
      await processTelegramDeliveries(db, new TelegramBotClient('synthetic', fetchFn), NOW),
    ).toBe(0);
  });

  it('dead-letters lost send acknowledgements and expired send leases without resending', async () => {
    const { db } = await setup();
    await acceptTelegramCommand(db, USER, 720, '123', { kind: 'send', text: 'synthetic' }, NOW);
    await acceptTelegramCommand(db, USER, 721, '123', { kind: 'send', text: 'synthetic' }, NOW);
    await db
      .prepare(
        "UPDATE telegram_deliveries SET status='leased',lease_until=?,attempts=1 WHERE update_id=721",
      )
      .bind(NOW)
      .run();
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error('Lost ACK');
    });
    await processTelegramDeliveries(db, new TelegramBotClient('synthetic', fetchFn), NOW);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(
      (await db.prepare('SELECT status,last_error FROM telegram_deliveries').all()).results,
    ).toEqual([
      { status: 'dead', last_error: 'unknown_outcome' },
      { status: 'dead', last_error: 'unknown_outcome' },
    ]);
    await processTelegramDeliveries(
      db,
      new TelegramBotClient('synthetic', fetchFn),
      '2026-10-14T01:10:00.000Z',
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('serializes concurrent edits and converges to the newest revision without double delivery', async () => {
    const { db } = await setup();
    await db.batch(
      telegramMutationStatements(
        db,
        'synthetic-edit-1',
        { updateId: 730, chatId: '123', messageId: 90 },
        { kind: 'edit', text: 'older' },
        {},
        NOW,
      ),
    );
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { text: string };
      seen.push(payload.text);
      if (payload.text === 'older') {
        started();
        await gate;
      }
      return Response.json({ ok: true });
    };
    const bot = new TelegramBotClient('synthetic', fetchFn);
    const first = processTelegramDeliveries(db, bot, NOW);
    await began;
    await db.batch(
      telegramMutationStatements(
        db,
        'synthetic-edit-2',
        { updateId: 731, chatId: '123', messageId: 90 },
        { kind: 'edit', text: 'newer' },
        {},
        NOW,
      ),
    );
    expect(await processTelegramDeliveries(db, bot, NOW)).toBe(0);
    release();
    await first;
    await Promise.all([
      processTelegramDeliveries(db, bot, NOW),
      processTelegramDeliveries(db, bot, NOW),
    ]);
    expect(seen).toEqual(['older', 'newer']);
  });

  it('skips obsolete revisions and isolates a poison payload from valid jobs', async () => {
    const { db } = await setup();
    for (const id of [740, 741])
      await db.batch(
        telegramMutationStatements(
          db,
          `edit-${id}`,
          { updateId: id, chatId: '123', messageId: 90 },
          { kind: 'edit', text: String(id) },
          {},
          NOW,
        ),
      );
    await acceptTelegramCommand(db, USER, 742, '123', { kind: 'send', text: 'synthetic' }, NOW);
    await db.prepare("UPDATE telegram_deliveries SET payload_json='{}' WHERE update_id=741").run();
    const fetchFn = vi.fn(success);
    await processTelegramDeliveries(db, new TelegramBotClient('synthetic', fetchFn), NOW);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(
      await db.prepare('SELECT last_error FROM telegram_deliveries WHERE update_id=740').first(),
    ).toEqual({ last_error: 'superseded' });
    expect(
      await db.prepare('SELECT last_error FROM telegram_deliveries WHERE update_id=741').first(),
    ).toEqual({ last_error: 'invalid_payload' });
  });

  it('retries only definite send failures, stops at three attempts and never regrades', async () => {
    const { db } = await setup();
    await acceptTelegramCommand(db, USER, 750, '123', { kind: 'send', text: 'synthetic' }, NOW);
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ ok: false }, { status: 429 }));
    const bot = new TelegramBotClient('synthetic', fetchFn);
    for (const now of [
      NOW,
      '2026-10-14T01:01:00.000Z',
      '2026-10-14T01:03:00.000Z',
      '2026-10-14T01:10:00.000Z',
    ])
      await processTelegramDeliveries(db, bot, now);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(await db.prepare('SELECT status,attempts FROM telegram_deliveries').first()).toEqual({
      status: 'dead',
      attempts: 3,
    });
  });

  it('claims one digest concurrently, mirrors state atomically and makes finish replay safe', async () => {
    const { db, repo } = await setup();
    const claims = await Promise.all([
      repo.claimDailyDigest(USER, 'cron1', '2026-10-14', 10, NOW),
      repo.claimDailyDigest(USER, 'cron2', '2026-10-14', 10, NOW),
    ]);
    const claim = claims.find((c) => !c.already_dispatched)!;
    expect(claim.due_cards).toHaveLength(1);
    expect(claims.filter((c) => c.already_dispatched)).toHaveLength(1);
    const input = {
      dispatch_id: claim.dispatch_id,
      claim_token: claim.claim_token!,
      status: 'sent' as const,
      message_id: 99,
    };
    await repo.finishDailyDigest(USER, 'finish', input);
    await repo.finishDailyDigest(USER, 'retry', input);
    await expect(
      repo.finishDailyDigest(USER, 'wrong', { ...input, status: 'failed' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await db.prepare('SELECT * FROM sync_outbox').all()).results).toHaveLength(3);
    expect(
      (await repo.claimDailyDigest(USER, 'later', '2026-10-14', 10, NOW)).already_dispatched,
    ).toBe(true);
  });

  it('marks a crashed digest unknown, respects pause and does not retry ambiguous sends', async () => {
    const { db, repo, setNow } = await setup();
    const claim = await repo.claimDailyDigest(USER, 'crash', '2026-10-14', 10, NOW);
    const later = '2026-10-14T01:03:00.000Z';
    setNow(later);
    expect(
      (await repo.claimDailyDigest(USER, 'recover', '2026-10-14', 10, later)).already_dispatched,
    ).toBe(true);
    expect(await db.prepare('SELECT status FROM daily_dispatches').first()).toEqual({
      status: 'unknown',
    });
    await expect(
      repo.finishDailyDigest(USER, 'late', {
        dispatch_id: claim.dispatch_id,
        claim_token: claim.claim_token!,
        status: 'sent',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await repo.updateUserPreferences(USER, 'pause', 'telegram_pause_test', {
      notifications_enabled: false,
    });
    const fetchFn = vi.fn(success);
    expect(
      (
        await handleScheduledCron(Date.parse('2026-10-15T01:00:00.000Z'), ENV, {
          reviewRepo: repo,
          fetchFn,
        })
      ).reason,
    ).toBe('notifications_disabled');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('Cron retries definite failures with backoff but does not resend unknown results', async () => {
    const { repo } = await setup();
    let unknown = false;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (unknown) throw new Error('Lost acknowledgement');
      return Response.json({ ok: false }, { status: 429 });
    });
    const run = (time: string) =>
      handleScheduledCron(Date.parse(time), ENV, { reviewRepo: repo, fetchFn });
    expect((await run(NOW)).reason).toBe('telegram_send_failed');
    expect((await run('2026-10-14T01:00:01.000Z')).reason).toBe('already_dispatched');
    unknown = true;
    await run('2026-10-14T01:01:00.000Z');
    expect((await run('2026-10-14T01:04:00.000Z')).reason).toBe('already_dispatched');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
