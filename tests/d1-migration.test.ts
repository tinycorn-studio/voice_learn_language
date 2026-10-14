// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { canonicalJson } from '@voice-chat/shared';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';
import { GasRepositoryAdapter, signGasPayload } from '../apps/worker/src/adapters/gas-client.js';
import { D1RepositoryAdapter } from '../apps/worker/src/adapters/d1-repository.js';
import {
  exportGasSnapshot,
  verifySnapshot,
  sealSnapshot,
  planMigration,
  importSnapshot,
  verifyImport,
  exportD1Snapshot,
  restoreGasSnapshot,
  type GasOperatorCall,
  type Snapshot,
} from '../scripts/lib/d1-migration.js';
import { createD1ApiBinding, renderSql } from '../scripts/lib/d1-api-binding.js';

const USER = 'telegram:123';
const KEY = 'synthetic-migration';
const WORD = {
  event_id: 'migration_create_word',
  word: 'bank',
  lemma: 'bank',
  part_of_speech: 'noun' as const,
  sense_key: 'financial',
  meaning_vi: '=protected',
  example: '',
  source_excerpt: '',
};
const runtimes: Awaited<ReturnType<typeof createD1RuntimeHarness>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});
function gasSetup(empty = false) {
  const props: Record<string, string> = {
    SHEET_ID: 'synthetic',
    OWNER_USER_ID: USER,
    GAS_SHARED_SECRET: KEY,
    SCHEMA_VERSION: '3',
  };
  const gas = createGasRuntimeHarness(props);
  if (!empty) gas.setupSheets();
  const fetchFn: typeof fetch = async (_url, init) =>
    new Response(gas.doPost(String(init?.body)).bodyText);
  const repo = new GasRepositoryAdapter('https://gas.example/exec', KEY, fetchFn);
  const call: GasOperatorCall = async (action, data) => {
    const payload = canonicalJson({
      action,
      event_id: `migration_${crypto.randomUUID()}`,
      issued_at: new Date().toISOString(),
      user_id: USER,
      request_id: 'synthetic',
      data,
    });
    const result: unknown = JSON.parse(
      gas.doPost(JSON.stringify({ payload, signature: await signGasPayload(payload, KEY) }))
        .bodyText,
    );
    return z.object({ ok: z.literal(true), data: z.unknown() }).parse(result).data;
  };
  return { props, gas, repo, call };
}
async function source() {
  const s = gasSetup();
  const created = await s.repo.upsert(USER, 'create', WORD);
  const rating = {
    event_id: 'migration_review_event',
    word_id: created.word_id,
    rating: 'hard' as const,
  };
  await s.repo.recordReview(USER, 'migration-review', rating, new Date().toISOString());
  await s.repo.updateUserPreferences(USER, 'prefs', 'migration_preferences', {
    telegram_chat_id: '123',
    notifications_enabled: true,
  });
  const cardSheet = s.gas.spreadsheet.getSheetByName('Cards')!;
  const independent = [...cardSheet.rows[1]!];
  independent[cardSheet.rows[0]!.indexOf('card_id')] = `reverse_${created.word_id}`;
  independent[cardSheet.rows[0]!.indexOf('card_type')] = 'reverse';
  cardSheet.appendRow(independent);
  const timestamp = new Date().toISOString();
  s.gas.spreadsheet
    .getSheetByName('DailyDispatchLog')!
    .appendRow([
      'digest_synthetic',
      USER,
      '2026-10-14',
      'sent',
      timestamp,
      timestamp,
      99,
      '',
      1,
      'synthetic-token',
    ]);
  s.gas.spreadsheet
    .getSheetByName('Settings')!
    .appendRow([
      USER,
      0.91,
      36500,
      '',
      'custom-settings',
      '{}',
      '',
      '',
      'Asia/Ho_Chi_Minh',
      new Date().toISOString(),
    ]);
  const freeze = z
    .object({ freeze_id: z.string() })
    .parse(await s.call('migration.freeze', { freeze: true }));
  const snapshot = await exportGasSnapshot(s.call, USER, freeze.freeze_id);
  return { ...s, created, rating, snapshot };
}
async function target() {
  const r = await createD1RuntimeHarness();
  runtimes.push(r);
  await r.db.prepare("UPDATE system_state SET value='false' WHERE key='writes_enabled'").run();
  return r.db;
}
async function reseal(snapshot: Snapshot) {
  return sealSnapshot({ ...snapshot });
}

describe('M7-07 full data migration and rollback', () => {
  it('scopes recovery to one owner and preserves all foreign records without weakening strict verification', async () => {
    const { snapshot } = await source();
    const plan = await planMigration(snapshot);
    const runtime = await createD1RuntimeHarness();
    runtimes.push(runtime);
    const repo = new D1RepositoryAdapter(runtime.db, KEY);
    await repo.upsert('telegram:999', 'foreign', { ...WORD, event_id: 'foreign_existing_create' });
    const foreign = (await runtime.db.prepare('SELECT record_json FROM words').all()).results;
    await runtime.db
      .prepare("UPDATE system_state SET value='false' WHERE key='writes_enabled'")
      .run();
    const backup = await exportD1Snapshot(runtime.db, USER, 'scoped', new Date().toISOString(), {
      onlyOwner: true,
    });
    expect(backup.tabs['Words']?.rows).toEqual([]);
    await expect(importSnapshot(runtime.db, plan, 'scoped')).rejects.toThrow('does not match');
    await importSnapshot(runtime.db, plan, 'scoped', { preserveOtherOwners: true });
    expect(await verifyImport(runtime.db, plan, { preserveOtherOwners: true })).toMatchObject({
      ok: true,
    });
    expect((await verifyImport(runtime.db, plan)).ok).toBe(false);
    expect(
      (
        await runtime.db
          .prepare('SELECT record_json FROM words WHERE user_id=?')
          .bind('telegram:999')
          .all()
      ).results,
    ).toEqual(foreign);
    expect(
      await runtime.db
        .prepare("SELECT value FROM system_state WHERE key='writes_enabled'")
        .first('value'),
    ).toBe('false');
  });

  it('enables mirror only for the current frozen source and rejects changing its epoch', async () => {
    const { call, props, repo } = gasSetup();
    await expect(
      call('migration.enableMirror', { freeze_id: 'stale', epoch: 'prod_cutover_01' }),
    ).rejects.toThrow();
    const freeze = z
      .object({ freeze_id: z.string() })
      .parse(await call('migration.freeze', { freeze: true }));
    const data = { freeze_id: freeze.freeze_id, epoch: 'prod_cutover_01' };
    expect(await call('migration.enableMirror', data)).toEqual({
      authority: 'd1',
      mirror_enabled: true,
      epoch: data.epoch,
    });
    expect(await call('migration.enableMirror', data)).toMatchObject({ mirror_enabled: true });
    expect(props['WRITES_ENABLED']).toBe('false');
    await expect(call('migration.enableMirror', { ...data, epoch: 'other' })).rejects.toThrow();
    await expect(
      call('migration.freeze', { freeze: false, freeze_id: freeze.freeze_id }),
    ).rejects.toThrow();
    await expect(repo.upsert(USER, 'blocked-writer', WORD)).rejects.toThrow();
  });
  it('exports seven frozen tabs, imports/replays once and preserves independent Cards, native audits, settings and dispatch', async () => {
    const { snapshot, repo: gasRepo, created, rating } = await source();
    expect(Object.keys(snapshot.tabs)).toHaveLength(7);
    const plan = await planMigration(snapshot);
    expect(plan.quarantine).toEqual([]);
    const db = await target();
    await importSnapshot(db, plan, 'migration_test');
    await importSnapshot(db, plan, 'migration_test');
    expect(await verifyImport(db, plan)).toMatchObject({ ok: true, integrity: true });
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(1);
    expect((await db.prepare('SELECT * FROM cards').all()).results).toHaveLength(2);
    expect(await db.prepare('SELECT status FROM daily_dispatches').first('status')).toBe('sent');
    expect((await db.prepare('SELECT * FROM sync_outbox').all()).results).toHaveLength(0);
    const repo = new D1RepositoryAdapter(db, KEY);
    const now = new Date().toISOString();
    expect(await repo.preview(USER, 'd1', `c_${created.word_id}`, now)).toEqual(
      await gasRepo.preview(USER, 'migration-preview', `c_${created.word_id}`, now),
    );
    expect(await repo.upsert(USER, 'replay-create', WORD)).toMatchObject({
      word_id: created.word_id,
      duplicate_event: true,
    });
    expect(await repo.recordReview(USER, 'replay-review', rating, now)).toMatchObject({
      duplicate_event: true,
      idempotent_replay: true,
    });
    const records = plan.records;
    expect(records.Words[0]?.['meaning_vi']).toBe('=protected');
    expect(records.Reviews[0]?.['review_log_json']).toBeTruthy();
    mkdirSync('.artifacts/M7-07', { recursive: true });
    writeFileSync('.artifacts/M7-07/synthetic-snapshot.json', canonicalJson(snapshot));
  });

  it('freezes/drains every GAS writer, rejects stale freeze IDs and rechecks after request validation', async () => {
    const { gas, props, repo, call } = gasSetup();
    const first = z
      .object({ freeze_id: z.string() })
      .parse(await call('migration.freeze', { freeze: true }));
    expect(await call('migration.freeze', { freeze: true })).toMatchObject(first);
    await expect(repo.upsert(USER, 'frozen', WORD)).rejects.toThrow();
    expect(() => gas.setupSheets()).toThrow('Writes');
    expect(() => gas.migrateSchemaV3(false)).toThrow('Writes');
    await expect(
      call('migration.exportPage', { freeze_id: 'stale', tab: 'Words', offset: 0, limit: 50 }),
    ).rejects.toThrow();
    await expect(call('migration.freeze', { freeze: false, freeze_id: 'stale' })).rejects.toThrow();
    await call('migration.freeze', { freeze: false, freeze_id: first.freeze_id });
    const original = gas.spreadsheet.getSheetByName.bind(gas.spreadsheet);
    vi.spyOn(gas.spreadsheet, 'getSheetByName').mockImplementation((name) => {
      if (name === 'Words') props['WRITES_ENABLED'] = 'false';
      return original(name);
    });
    await expect(repo.upsert(USER, 'raced-freeze', WORD)).rejects.toThrow();
    expect(original('Words')!.rows).toHaveLength(1);
  });

  it('blocks tampered snapshots, invalid booleans, duplicates, missing fingerprints and orphan audits without touching the target', async () => {
    const { snapshot } = await source();
    const tampered = structuredClone(snapshot);
    tampered.tabs.Words!.rows[0]![3] = 'modified';
    await expect(verifySnapshot(tampered)).rejects.toThrow('checksum');
    const invalid = structuredClone(snapshot);
    invalid.tabs.Words!.rows.push([...invalid.tabs.Words!.rows[0]!]);
    const users = invalid.tabs.Users!;
    users.rows[0]![users.headers.indexOf('notifications_enabled')] = 'maybe';
    const events = invalid.tabs.Events!;
    events.rows[0]![events.headers.indexOf('payload_hash')] = '';
    const reviews = invalid.tabs.Reviews!;
    reviews.rows[0]![reviews.headers.indexOf('card_id')] = 'missing-card';
    const plan = await planMigration(await reseal(invalid));
    expect(plan.quarantine.length).toBeGreaterThanOrEqual(4);
    const db = await target();
    await expect(importSnapshot(db, plan, 'test')).rejects.toThrow('quarantine');
    expect((await db.prepare('SELECT * FROM words').all()).results).toHaveLength(0);
  });

  it('materializes missing legacy Cards explicitly, preserving due/counts/suspension and never resetting native Cards', async () => {
    const { snapshot } = await source();
    const legacy = structuredClone(snapshot);
    legacy.tabs.Cards!.rows = [];
    legacy.tabs.Reviews!.rows = [];
    const eventTypeIndex = legacy.tabs.Events!.headers.indexOf('event_type');
    legacy.tabs.Events!.rows = legacy.tabs.Events!.rows.filter(
      (row) => row[eventTypeIndex] !== 'review.record',
    );
    expect(
      (await planMigration(await reseal(legacy))).quarantine.some((r) =>
        r.reason.includes('materialization'),
      ),
    ).toBe(true);
    const plan = await planMigration(await reseal(legacy), true);
    expect(plan.quarantine).toEqual([]);
    expect(plan.generated_cards).toHaveLength(1);
    expect(plan.records.Cards[0]).toMatchObject({
      state: 'New',
      stability: 0,
      difficulty: 0,
      due_at_utc: plan.records.Words[0]?.['due_at'],
      reps: plan.records.Words[0]?.['repetitions'],
      scheduled_days: plan.records.Words[0]?.['interval_days'],
    });
    const native = await planMigration(snapshot, true);
    expect(native.generated_cards).toEqual([]);
    expect(native.records.Cards[0]?.['state']).toBe('Learning');
  });

  it('paginates >50 rows and resumes after a failed import chunk without duplicate Reviews/Events', async () => {
    const s = gasSetup();
    for (let i = 0; i < 51; i++)
      await s.repo.upsert(USER, 'batch-create', {
        ...WORD,
        event_id: `migration_bulk_${i}`,
        word: `word${i}`,
        lemma: `word${i}`,
      });
    const firstId = String(s.gas.spreadsheet.getSheetByName('Words')!.rows[1]![0]);
    await s.repo.recordReview(
      USER,
      'migration-bulk-review',
      { event_id: 'migration_bulk_review', word_id: firstId, rating: 'good' },
      new Date().toISOString(),
    );
    const freeze = z
      .object({ freeze_id: z.string() })
      .parse(await s.call('migration.freeze', { freeze: true }));
    const plan = await planMigration(await exportGasSnapshot(s.call, USER, freeze.freeze_id));
    expect(plan.records.Words).toHaveLength(51);
    expect(plan.quarantine).toEqual([]);
    const db = await target();
    await db
      .prepare(
        "CREATE TRIGGER synthetic_import_crash BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'synthetic crash'); END;",
      )
      .run();
    await expect(importSnapshot(db, plan, 'resume_test')).rejects.toThrow();
    expect((await db.prepare('SELECT * FROM words').all()).results).toHaveLength(51);
    expect(
      await db.prepare("SELECT value FROM system_state WHERE key='writes_enabled'").first('value'),
    ).toBe('false');
    await db.prepare('DROP TRIGGER synthetic_import_crash').run();
    await importSnapshot(db, plan, 'resume_test');
    expect(await verifyImport(db, plan)).toMatchObject({ ok: true });
    expect((await db.prepare('SELECT * FROM reviews').all()).results).toHaveLength(1);
  }, 15000);

  it('detects a differing target and refuses to overwrite it or activate writes', async () => {
    const { snapshot } = await source();
    const plan = await planMigration(snapshot);
    const db = await target();
    await importSnapshot(db, plan, 'same_epoch');
    await db
      .prepare(
        "UPDATE words SET record_json=json_set(record_json,'$.meaning_vi','different target')",
      )
      .run();
    expect((await verifyImport(db, plan)).ok).toBe(false);
    await expect(importSnapshot(db, plan, 'same_epoch')).rejects.toThrow('does not match');
    expect(
      String(await db.prepare('SELECT record_json FROM words').first('record_json')),
    ).toContain('different target');
    expect(
      await db.prepare("SELECT value FROM system_state WHERE key='writes_enabled'").first('value'),
    ).toBe('false');
  });

  it('reverse-exports D1 into a separate frozen GAS target, replays restore and verifies all canonical records', async () => {
    const { snapshot } = await source();
    const plan = await planMigration(snapshot);
    const db = await target();
    await importSnapshot(db, plan, 'rollback_epoch');
    const backup = await exportD1Snapshot(db, USER, 'reverse_snapshot', new Date().toISOString());
    const restored = gasSetup(true);
    const freeze = z
      .object({ freeze_id: z.string() })
      .parse(await restored.call('migration.freeze', { freeze: true }));
    await restoreGasSnapshot(restored.call, backup, freeze.freeze_id);
    await restoreGasSnapshot(restored.call, backup, freeze.freeze_id);
    const roundtrip = await planMigration(
      await exportGasSnapshot(restored.call, USER, freeze.freeze_id),
    );
    expect(roundtrip.quarantine).toEqual([]);
    expect(await verifyImport(db, roundtrip)).toMatchObject({ ok: true });
    expect(restored.gas.spreadsheet.getSheetByName('Reviews')!.rows).toHaveLength(2);
    restored.props['DATA_AUTHORITY'] = 'd1';
    await expect(restoreGasSnapshot(restored.call, backup, freeze.freeze_id)).rejects.toThrow();
    restored.props['DATA_AUTHORITY'] = 'gas';
    await restored.call('migration.freeze', { freeze: false, freeze_id: freeze.freeze_id });
    const words = restored.gas.spreadsheet.getSheetByName('Words')!;
    expect(words.rows[1]![words.rows[0]!.indexOf('_snapshot_json')]).toBe('');
    await restored.repo.update(
      USER,
      'post-restore-edit',
      String(plan.records.Words[0]!['word_id']),
      {
        event_id: 'post_restore_edit_event',
        version: Number(plan.records.Words[0]!['version']),
        meaning_vi: 'sửa sau restore',
      },
    );
    const nextFreeze = z
      .object({ freeze_id: z.string() })
      .parse(await restored.call('migration.freeze', { freeze: true }));
    const updated = await planMigration(
      await exportGasSnapshot(restored.call, USER, nextFreeze.freeze_id),
    );
    expect(updated.quarantine).toEqual([]);
    expect(updated.records.Words[0]?.['meaning_vi']).toBe('sửa sau restore');
  });

  it('escapes operator SQL and validates the remote batch response without exposing credentials', async () => {
    expect(renderSql("SELECT '?' AS literal, ? AS value", ["x'); DROP TABLE words; --"])).toBe(
      "SELECT '?' AS literal, 'x''); DROP TABLE words; --' AS value",
    );
    expect(() => renderSql('SELECT ?', [])).toThrow();
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { batch: { sql: string }[] };
      return Response.json({
        success: true,
        result: body.batch.map(() => ({
          success: true,
          results: [{ value: 'synthetic' }],
          meta: {},
        })),
      });
    });
    const db = createD1ApiBinding({
      accountId: 'a'.repeat(32),
      databaseId: '00000000-0000-4000-8000-000000000001',
      token: 'synthetic',
      fetchFn,
    });
    expect(await db.prepare('SELECT ? AS value').bind('synthetic').first('value')).toBe(
      'synthetic',
    );
    expect(await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')])).toHaveLength(2);
  });
});
