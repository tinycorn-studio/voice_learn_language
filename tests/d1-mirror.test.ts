// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, mirrorJobSchema } from '@voice-chat/shared';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';
import { D1RepositoryAdapter } from '../apps/worker/src/adapters/d1-repository.js';
import {
  processSheetMirror,
  getMirrorHealth,
  enqueueMirrorRebuild,
  requeueMirrorJob,
} from '../apps/worker/src/adapters/sheet-mirror.js';
import { signGasPayload } from '../apps/worker/src/adapters/gas-client.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';

const USER = 'telegram:123';
const ENV: WorkerEnv = {
  DATA_BACKEND: 'd1',
  SHEET_MIRROR_ENABLED: 'true',
  SHEET_MIRROR_EPOCH: 'test_epoch',
  OWNER_TELEGRAM_ID: '123',
  GEMINI_API_KEY: 'synthetic',
  TELEGRAM_BOT_TOKEN: 'synthetic',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic',
  GAS_SHARED_SECRET: 'synthetic',
  GAS_EXEC_URL: 'https://gas.example/exec',
};
const runtimes: Awaited<ReturnType<typeof createD1RuntimeHarness>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});
async function setup() {
  const runtime = await createD1RuntimeHarness();
  runtimes.push(runtime);
  const { db } = runtime;
  await db
    .prepare("UPDATE system_state SET value=? WHERE key='source_epoch'")
    .bind(ENV.SHEET_MIRROR_EPOCH!)
    .run();
  const repo = new D1RepositoryAdapter(db, ENV.GAS_SHARED_SECRET);
  const created = await repo.upsert(USER, 'create', {
    event_id: 'mirror_create_word',
    word: 'bank',
    part_of_speech: 'noun',
    sense_key: 'financial',
    meaning_vi: '=formula-safe',
    example: '',
    source_excerpt: '',
  });
  const props = {
    SHEET_ID: 'synthetic',
    OWNER_USER_ID: USER,
    GAS_SHARED_SECRET: ENV.GAS_SHARED_SECRET,
    DATA_AUTHORITY: 'd1',
    MIRROR_ENABLED: 'true',
    MIRROR_EPOCH: ENV.SHEET_MIRROR_EPOCH!,
  };
  const gas = createGasRuntimeHarness(props);
  gas.setupSheets();
  const fetchFn: typeof fetch = async (_url, init) =>
    new Response(gas.doPost(String(init?.body)).bodyText);
  async function jobs() {
    return (
      await db.prepare('SELECT payload_json FROM sync_outbox ORDER BY sequence').all()
    ).results.map((r) => mirrorJobSchema.parse(JSON.parse(String(r['payload_json'])) as unknown));
  }
  async function apply(job: unknown, epoch = ENV.SHEET_MIRROR_EPOCH) {
    const payload = canonicalJson({
      action: 'mirror.applyBatch',
      event_id: 'mirror_test_direct',
      issued_at: new Date().toISOString(),
      user_id: USER,
      request_id: 'synthetic',
      data: { epoch, jobs: [job] },
    });
    return JSON.parse(
      gas.doPost(
        JSON.stringify({
          payload,
          signature: await signGasPayload(payload, ENV.GAS_SHARED_SECRET),
        }),
      ).bodyText,
    ) as { ok: boolean; error?: { code: string } };
  }
  return { db, repo, created, gas, props, fetchFn, jobs, apply };
}
const now = () => new Date().toISOString();
const future = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();

describe('M7-06 D1 -> Sheet mirror', () => {
  it('Google outage never blocks authoritative create/review and lost ACK retry does not duplicate rows', async () => {
    const { db, repo, created, gas, fetchFn } = await setup();
    await repo.recordReview(
      USER,
      'review',
      { event_id: 'mirror_review_event', word_id: created.word_id, rating: 'good' },
      now(),
    );
    const down: typeof fetch = async () => {
      throw new Error('Google unavailable');
    };
    expect(await processSheetMirror(db, ENV, now(), down)).toBe(0);
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(1);
    const lostAck: typeof fetch = async (url, init) => {
      await fetchFn(url, init);
      throw new Error('Lost ACK');
    };
    await processSheetMirror(db, ENV, future(1), lostAck);
    expect(gas.spreadsheet.getSheetByName('Words')!.rows).toHaveLength(2);
    await processSheetMirror(db, ENV, future(3), fetchFn);
    await processSheetMirror(db, ENV, now(), fetchFn);
    expect(gas.spreadsheet.getSheetByName('Words')!.rows).toHaveLength(2);
    expect(gas.spreadsheet.getSheetByName('Cards')!.rows).toHaveLength(2);
    expect(gas.spreadsheet.getSheetByName('Reviews')!.rows).toHaveLength(2);
    expect(gas.spreadsheet.getSheetByName('Events')!.rows).toHaveLength(3);
    const words = gas.spreadsheet.getSheetByName('Words')!;
    expect(words.rows[1]?.[words.rows[0]!.indexOf('meaning_vi')]).toBe("'=formula-safe");
    expect((await getMirrorHealth(db, now())).find((r) => r.status === 'delivered')?.count).toBe(2);
  });

  it('rejects same-version changes/epoch mismatch and skips older versions without overwriting corrections', async () => {
    const { repo, created, gas, jobs, apply } = await setup();
    await repo.update(USER, 'edit', created.word_id, {
      event_id: 'mirror_update_word',
      meaning_vi: 'đã sửa',
      version: 1,
    });
    const values = await jobs();
    expect((await apply(values[1])).ok).toBe(true);
    expect((await apply(values[0])).ok).toBe(true);
    const words = gas.spreadsheet.getSheetByName('Words')!;
    expect(words.rows[1]?.[words.rows[0]!.indexOf('meaning_vi')]).toBe('đã sửa');
    expect((await apply(values[1], 'wrong_epoch')).error?.code).toBe('CONFLICT');
    const altered = structuredClone(values[1]!);
    altered.entities[0]!.row['meaning_vi'] = 'changed without version';
    expect((await apply(altered)).error?.code).toBe('CONFLICT');
    expect(words.rows).toHaveLength(2);
  });

  it('repairs a crash between tab writes and preserves append-only Reviews', async () => {
    const { db, repo, created, gas, fetchFn } = await setup();
    await processSheetMirror(db, ENV, now(), fetchFn);
    await repo.recordReview(
      USER,
      'review',
      { event_id: 'mirror_crash_review', word_id: created.word_id, rating: 'hard' },
      now(),
    );
    const reviews = gas.spreadsheet.getSheetByName('Reviews')!;
    const original = reviews.getRange.bind(reviews);
    let crash = true;
    vi.spyOn(reviews, 'getRange').mockImplementation((...args) => {
      const range = original(...args);
      return {
        ...range,
        setValues: (values: unknown[][]) => {
          if (crash) {
            crash = false;
            throw new Error('Synthetic write crash');
          }
          range.setValues(values);
        },
      };
    });
    expect(await processSheetMirror(db, ENV, now(), fetchFn)).toBe(0);
    expect(await processSheetMirror(db, ENV, future(1), fetchFn)).toBe(1);
    expect(reviews.rows).toHaveLength(2);
    const index = reviews.rows[0]!.indexOf('review_log_json');
    expect(JSON.parse(String(reviews.rows[1]![index]))).toBeTruthy();
  });

  it('uses a durable global lease across processors and recovers an expired lease', async () => {
    const { db, fetchFn } = await setup();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const slow: typeof fetch = async (url, init) => {
      started();
      await gate;
      return fetchFn(url, init);
    };
    const first = processSheetMirror(db, ENV, now(), slow);
    await began;
    expect(await processSheetMirror(db, ENV, now(), fetchFn)).toBe(0);
    release();
    expect(await first).toBe(1);
    await db
      .prepare("UPDATE sync_processor_lease SET lease_token='crashed',lease_until=?")
      .bind(now())
      .run();
    expect(await processSheetMirror(db, ENV, future(1), fetchFn)).toBe(0);
    expect(await db.prepare('SELECT lease_token FROM sync_processor_lease').first()).toEqual({
      lease_token: '',
    });
  });

  it('dead-letters permanent conflicts and supports explicit requeue after repair', async () => {
    const { db, fetchFn, props } = await setup();
    props.MIRROR_EPOCH = 'wrong_epoch';
    await processSheetMirror(db, ENV, now(), fetchFn);
    expect((await getMirrorHealth(db, future(2))).find((r) => r.status === 'dead')).toMatchObject({
      count: 1,
    });
    props.MIRROR_EPOCH = ENV.SHEET_MIRROR_EPOCH!;
    expect(await requeueMirrorJob(db, 'mirror_create_word', now())).toBe(true);
    expect(await processSheetMirror(db, ENV, now(), fetchFn)).toBe(1);
  });

  it('rebuilds all canonical snapshots resumably while writes are frozen', async () => {
    const { db, repo, created, fetchFn, gas } = await setup();
    await repo.recordReview(
      USER,
      'review',
      { event_id: 'mirror_rebuild_review', word_id: created.word_id, rating: 'easy' },
      now(),
    );
    await expect(enqueueMirrorRebuild(db, 'test_epoch', now())).rejects.toThrow('Freeze');
    await db.prepare("UPDATE system_state SET value='false' WHERE key='writes_enabled'").run();
    expect(await enqueueMirrorRebuild(db, 'test_epoch', now())).toBe(5);
    expect(await enqueueMirrorRebuild(db, 'test_epoch', now())).toBe(0);
    for (let i = 0; i < 7; i++) await processSheetMirror(db, ENV, now(), fetchFn);
    expect(gas.spreadsheet.getSheetByName('Words')!.rows).toHaveLength(2);
    expect(gas.spreadsheet.getSheetByName('Reviews')!.rows).toHaveLength(2);
    expect(gas.spreadsheet.getSheetByName('Events')!.rows).toHaveLength(3);
  });

  it('rejects unsigned/foreign/legacy writes when D1 is authoritative and checks source epoch', async () => {
    const { db, gas, jobs, apply } = await setup();
    expect(
      JSON.parse(gas.doPost(JSON.stringify({ payload: '{}', signature: 'invalid' })).bodyText),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_SIGNATURE' } });
    const job = (await jobs())[0]!;
    job.entities[0]!.row['user_id'] = 'telegram:999';
    expect((await apply(job)).error?.code).toBe('CONFLICT');
    const payload = JSON.stringify({
      action: 'vocabulary.delete',
      event_id: 'legacy_delete_test',
      issued_at: now(),
      user_id: USER,
      request_id: 'synthetic',
      data: {},
    });
    expect(
      JSON.parse(
        gas.doPost(
          JSON.stringify({
            payload,
            signature: await signGasPayload(payload, ENV.GAS_SHARED_SECRET),
          }),
        ).bodyText,
      ),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await expect(
      processSheetMirror(db, { ...ENV, SHEET_MIRROR_EPOCH: 'wrong' }, now()),
    ).rejects.toThrow('epoch');
  });
});
