import { describe, expect, it } from 'vitest';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';
import {
  GasRepositoryAdapter,
  buildSignedGasEnvelope,
} from '../apps/worker/src/adapters/gas-client.js';
import {
  handleScheduledCron,
  handleWorkerRequest,
  SecurityStateStore,
} from '../apps/worker/src/entry.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';
import { TelegramBotClient } from '../apps/worker/src/adapters/telegram-bot-client.js';

const ENV: WorkerEnv = {
  GEMINI_API_KEY: 'synthetic-gemini',
  TELEGRAM_BOT_TOKEN: 'synthetic-bot',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic-webhook',
  OWNER_TELEGRAM_ID: '123',
  GAS_SHARED_SECRET: 'synthetic-review-secret',
  GAS_EXEC_URL: 'https://gas.example/exec',
};
const WORD = {
  event_id: 'review_create_001',
  word: 'bank',
  part_of_speech: 'noun' as const,
  sense_key: 'financial',
  meaning_vi: 'ngân hàng',
  example: '',
  source_excerpt: 'What does bank mean?',
};
function setup() {
  const gas = createGasRuntimeHarness({
    SHEET_ID: 'synthetic',
    GAS_SHARED_SECRET: ENV.GAS_SHARED_SECRET,
    OWNER_USER_ID: 'telegram:123',
  });
  gas.setupSheets();
  const fetchFn: typeof fetch = async (_url, init) =>
    new Response(gas.doPost(String(init?.body)).bodyText, { status: 200 });
  return {
    gas,
    fetchFn,
    repo: new GasRepositoryAdapter(ENV.GAS_EXEC_URL, ENV.GAS_SHARED_SECRET, fetchFn),
  };
}
function webhook(update: unknown) {
  return new Request('https://worker.example/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': ENV.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify(update),
  });
}
describe('M5-05 review regressions: GAS and Telegram', () => {
  it('migrates v1 headers twice without changing existing data', () => {
    const props = { SHEET_ID: 'synthetic', SCHEMA_VERSION: '1' };
    const gas = createGasRuntimeHarness(props);
    gas.setupSheets();
    const events = gas.spreadsheet.getSheetByName('Events')!;
    const dispatches = gas.spreadsheet.getSheetByName('DailyDispatchLog')!;
    events.rows[0]!.pop();
    dispatches.rows[0]!.pop();
    events.appendRow(['old-event', 'vocabulary.update']);
    dispatches.appendRow(['old-dispatch', 'telegram:123', '2026-10-11', 'sent']);
    const before = JSON.stringify([events.rows[1], dispatches.rows[1]]);
    gas.migrateSchemaV2();
    gas.migrateSchemaV2();
    expect(events.rows[0]).toHaveLength(10);
    expect(dispatches.rows[0]).toHaveLength(10);
    expect(JSON.stringify([events.rows[1], dispatches.rows[1]])).toBe(before);
    expect(props.SCHEMA_VERSION).toBe('2');
  });
  it('R05 replays PATCH original result even after another update; same event with different payload conflicts', async () => {
    const { repo, gas } = setup();
    const created = await repo.upsert('telegram:123', 'request-create', WORD);
    const patch = { event_id: 'review_patch_001', version: 1, meaning_vi: 'sửa nghĩa' };
    const result = await repo.update('telegram:123', 'request-patch', created.word_id, patch);
    await repo.update('telegram:123', 'request-patch2', created.word_id, {
      ...patch,
      event_id: 'review_patch_002',
      version: 2,
      meaning_vi: 'nghĩa mới hơn',
    });
    expect(await repo.update('telegram:123', 'request-retry', created.word_id, patch)).toEqual(
      result,
    );
    expect(gas.spreadsheet.getSheetByName('Events')?.getLastRow()).toBe(4);
    await expect(
      repo.update('telegram:123', 'request-changed', created.word_id, {
        ...patch,
        meaning_vi: 'khác',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('R05 replays DELETE without incrementing version or adding Events; restore remains active', async () => {
    const { repo, gas } = setup();
    const created = await repo.upsert('telegram:123', 'request-create', WORD);
    await repo.softDelete('telegram:123', 'request-delete', created.word_id, 'review_delete_001');
    await repo.softDelete('telegram:123', 'request-retry', created.word_id, 'review_delete_001');
    expect(gas.spreadsheet.getSheetByName('Events')?.getLastRow()).toBe(3);
    await repo.upsert('telegram:123', 'request-restore', {
      ...WORD,
      event_id: 'review_create_002',
    });
    await repo.softDelete(
      'telegram:123',
      'request-old-retry',
      created.word_id,
      'review_delete_001',
    );
    expect((await repo.listDue('telegram:123', 'request-due', 10)).items).toHaveLength(1);
  });
  it('R06 rejects key collision before changing any field', async () => {
    const { repo, gas } = setup();
    await repo.upsert('telegram:123', 'request-create', WORD);
    const second = await repo.upsert('telegram:123', 'request-create2', {
      ...WORD,
      event_id: 'review_create_002',
      sense_key: 'river',
    });
    const before = JSON.stringify(gas.spreadsheet.getSheetByName('Words')?.rows);
    await expect(
      repo.update('telegram:123', 'request-collision', second.word_id, {
        event_id: 'review_patch_001',
        version: 1,
        sense_key: 'financial',
        meaning_vi: 'không được ghi',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(gas.spreadsheet.getSheetByName('Words')?.rows)).toBe(before);
  });
  it('R03 retries failed callback, then deduplicates across fresh isolates in GAS', async () => {
    const { repo, gas, fetchFn } = setup();
    const word = await repo.upsert('telegram:123', 'request-create', WORD);
    let gasAttempts = 0;
    const transient: typeof fetch = async (url, init) => {
      if (String(url) === ENV.GAS_EXEC_URL && ++gasAttempts === 1)
        throw new Error('synthetic outage');
      if (String(url).includes('api.telegram.org'))
        return new Response('{"ok":true}', { status: 200 });
      return fetchFn(url, init);
    };
    const store = new SecurityStateStore();
    const update = {
      update_id: 42,
      callback_query: { id: 'callback42', from: { id: 123 }, data: `r:${word.word_id}:good` },
    };
    expect(
      (await handleWorkerRequest(webhook(update), ENV, { fetchFn: transient }, store)).status,
    ).toBe(503);
    expect(
      (await handleWorkerRequest(webhook(update), ENV, { fetchFn: transient }, store)).status,
    ).toBe(200);
    expect(
      (
        await handleWorkerRequest(
          webhook(update),
          ENV,
          { fetchFn: transient },
          new SecurityStateStore(),
        )
      ).status,
    ).toBe(200);
    expect(gas.spreadsheet.getSheetByName('Reviews')?.getLastRow()).toBe(2);
    const list = await repo.list('telegram:123', 'request-list', { limit: 20 });
    expect(list.items[0]?.repetitions).toBe(1);
  });
  it('R04 only marks sent after acknowledgement, retries explicit failure after backoff once', async () => {
    const { repo, gas, fetchFn } = setup();
    await repo.upsert('telegram:123', 'request-create', WORD);
    let sends = 0;
    const telegram: typeof fetch = async (url, init) => {
      if (!String(url).includes('api.telegram.org')) return fetchFn(url, init);
      sends++;
      return sends === 1
        ? new Response('{"ok":false}', { status: 503 })
        : new Response('{"ok":true,"result":{"message_id":77}}', { status: 200 });
    };
    const now = Date.now();
    expect((await handleScheduledCron(now, ENV, { fetchFn: telegram })).reason).toBe(
      'telegram_send_failed',
    );
    const log = gas.spreadsheet.getSheetByName('DailyDispatchLog')!;
    expect(log.rows[1]?.[3]).toBe('failed');
    expect(log.rows[1]?.[5]).toBe('');
    expect((await handleScheduledCron(now + 1000, ENV, { fetchFn: telegram })).reason).toBe(
      'already_dispatched',
    );
    expect((await handleScheduledCron(now + 31000, ENV, { fetchFn: telegram })).reason).toBe(
      'sent',
    );
    expect(log.rows[1]?.[3]).toBe('sent');
    expect(String(log.rows[1]?.[6])).toBe('77');
    await handleScheduledCron(now + 60000, ENV, { fetchFn: telegram });
    expect(sends).toBe(2);
  });
  it('R04 preserves unknown outcome and refuses automatic resend after timeout', async () => {
    const { repo, gas, fetchFn } = setup();
    await repo.upsert('telegram:123', 'request-create', WORD);
    let sends = 0;
    const timeout: typeof fetch = async (url, init) => {
      if (!String(url).includes('api.telegram.org')) return fetchFn(url, init);
      sends++;
      throw new Error('synthetic timeout');
    };
    const now = Date.now();
    await handleScheduledCron(now, ENV, { fetchFn: timeout });
    await handleScheduledCron(now + 360000, ENV, { fetchFn: timeout });
    expect(gas.spreadsheet.getSheetByName('DailyDispatchLog')?.rows[1]?.[3]).toBe('unknown');
    expect(sends).toBe(1);
  });
  it('R04 bounds definite failures to three sends across scheduled retry ticks', async () => {
    const { repo, gas, fetchFn } = setup();
    await repo.upsert('telegram:123', 'request-create', WORD);
    let sends = 0;
    const rejected: typeof fetch = async (url, init) => {
      if (!String(url).includes('api.telegram.org')) return fetchFn(url, init);
      sends++;
      return new Response('{"ok":false}', { status: 503 });
    };
    const now = Date.now();
    for (let minute = 0; minute <= 5; minute++)
      await handleScheduledCron(now + minute * 60000, ENV, { fetchFn: rejected });
    expect(sends).toBe(3);
    expect(gas.spreadsheet.getSheetByName('DailyDispatchLog')?.rows[1]?.[8]).toBe(3);
  });
  it('rejects a second rating from the same stale Telegram keyboard while permitting original replay', async () => {
    const { repo, gas, fetchFn } = setup();
    const word = await repo.upsert('telegram:123', 'request-create', WORD);
    const callback = TelegramBotClient.buildQuizKeyboard(word.word_id, 1)[0]![2]!.callback_data!;
    const telegram: typeof fetch = async (url, init) =>
      String(url).includes('api.telegram.org') ? new Response('{"ok":true}') : fetchFn(url, init);
    const update = (id: number) => ({
      update_id: id,
      callback_query: { id: `callback${id}`, from: { id: 123 }, data: callback },
    });
    expect(
      (
        await handleWorkerRequest(
          webhook(update(50)),
          ENV,
          { fetchFn: telegram },
          new SecurityStateStore(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleWorkerRequest(
          webhook(update(50)),
          ENV,
          { fetchFn: telegram },
          new SecurityStateStore(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleWorkerRequest(
          webhook(update(51)),
          ENV,
          { fetchFn: telegram },
          new SecurityStateStore(),
        )
      ).status,
    ).toBe(409);
    expect(gas.spreadsheet.getSheetByName('Reviews')?.getLastRow()).toBe(2);
  });
  it('rejects validly signed but expired GAS request without writes (TC-07)', async () => {
    const { gas } = setup();
    const envelope = await buildSignedGasEnvelope({
      action: 'vocabulary.upsert',
      eventId: WORD.event_id,
      userId: 'telegram:123',
      requestId: 'expired-request',
      data: WORD,
      sharedSecret: ENV.GAS_SHARED_SECRET,
      issuedAtIso: new Date(Date.now() - 600000).toISOString(),
    });
    expect(JSON.parse(gas.doPost(JSON.stringify(envelope)).bodyText).error.code).toBe(
      'EXPIRED_EVENT',
    );
    expect(gas.spreadsheet.getSheetByName('Words')?.getLastRow()).toBe(1);
  });
  it('persists pause opt-out through the webhook and suppresses scheduled digest', async () => {
    const { repo, fetchFn } = setup();
    await repo.upsert('telegram:123', 'request-create', WORD);
    let sends = 0;
    const telegram: typeof fetch = async (url, init) => {
      if (!String(url).includes('api.telegram.org')) return fetchFn(url, init);
      sends++;
      return new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 });
    };
    const update = {
      update_id: 43,
      message: { from: { id: 123 }, chat: { id: 123 }, text: '/pause' },
    };
    expect(
      (
        await handleWorkerRequest(
          webhook(update),
          ENV,
          { fetchFn: telegram },
          new SecurityStateStore(),
        )
      ).status,
    ).toBe(200);
    expect((await handleScheduledCron(Date.now(), ENV, { fetchFn: telegram })).reason).toBe(
      'notifications_disabled',
    );
    expect(sends).toBe(1);
  });
});
