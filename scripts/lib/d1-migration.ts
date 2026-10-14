import { z } from 'zod';
import {
  canonicalJson,
  MIRROR_IDS,
  mirrorTabSchema,
  vocabularyItemSchema,
  fsrsCardSchema,
  fsrsConfigSchema,
  createInitialFsrsCard,
  normalizeText,
  vocabularyCreateResponseSchema,
  reviewSubmitResponseSchema,
  type MirrorEntity,
} from '@voice-chat/shared';
import type { DatabaseBinding, Statement } from '../../apps/worker/src/adapters/d1-database.js';

const TABS = mirrorTabSchema.options;
const EMPTY_HEADERS = {
  Words:
    'word_id,user_id,word_key,word,lemma,part_of_speech,sense_key,meaning_vi,ipa,example,source_excerpt,created_at,last_asked_at,times_asked,review_state,repetitions,interval_days,ease_factor,due_at,last_reviewed_at,version,deleted_at',
  Cards:
    'card_id,user_id,word_id,card_type,state,due_at_utc,stability,difficulty,elapsed_days,scheduled_days,learning_steps,reps,lapses,last_review_at_utc,created_at_utc,updated_at_utc,row_version,scheduler_version,parameters_version,is_suspended,legacy_snapshot_json',
  Reviews:
    'review_id,event_id,user_id,card_id,word_id,rating,reviewed_at,old_due_at,new_due_at,old_interval_days,new_interval_days,previous_state,next_state,stability,difficulty,review_log_json,previous_version,next_version,scheduler_version,parameters_version,previous_card_json,next_card_json',
  Events:
    'event_id,event_type,user_id,entity_id,occurred_at,created_at,request_id,payload_hash,result_code,result_json',
  Settings:
    'user_id,desired_retention,maximum_interval,scheduler_version,parameters_version,scheduler_parameters_json,daily_new_card_limit,daily_review_limit,timezone,updated_at_utc',
  Users:
    'user_id,telegram_chat_id,timezone,notifications_enabled,daily_review_limit,reminder_local_hour,created_at,updated_at',
  DailyDispatchLog:
    'dispatch_id,user_id,local_date,status,claimed_at,sent_at,message_id,last_error,attempt_count,claim_token',
} as const;
const cellSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const tabSchema = z.object({
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(cellSchema)),
  sha256: z.string(),
});
export const snapshotSchema = z.object({
  format: z.literal('voice-d1-snapshot-v1'),
  owner_id: z.string().regex(/^telegram:\d+$/),
  freeze_id: z.string().min(1),
  frozen_at: z.string().datetime(),
  exported_at: z.string().datetime(),
  schema_version: z.string(),
  tabs: z.record(mirrorTabSchema, tabSchema),
  sha256: z.string(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type GasOperatorCall = (action: string, data: Record<string, unknown>) => Promise<unknown>;
export async function hashJson(value: unknown): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function sealSnapshot(value: Omit<Snapshot, 'sha256'>): Promise<Snapshot> {
  const content = snapshotSchema.omit({ sha256: true }).parse(value);
  for (const tab of TABS) {
    const table = content.tabs[tab];
    if (!table) throw new Error(`Missing snapshot tab: ${tab}`);
    table.sha256 = await hashJson({ headers: table.headers, rows: table.rows });
  }
  return snapshotSchema.parse({ ...content, sha256: await hashJson(content) });
}
export async function verifySnapshot(value: unknown): Promise<Snapshot> {
  const snapshot = snapshotSchema.parse(value);
  const { sha256, ...content } = snapshot;
  if ((await hashJson(content)) !== sha256) throw new Error('Snapshot checksum mismatch');
  for (const tab of TABS) {
    const table = snapshot.tabs[tab];
    if (!table || table.sha256 !== (await hashJson({ headers: table.headers, rows: table.rows })))
      throw new Error('Tab checksum mismatch');
    if (
      new Set(table.headers).size !== table.headers.length ||
      table.rows.some((r) => r.length !== table.headers.length)
    )
      throw new Error('Invalid snapshot layout');
  }
  return snapshot;
}
const pageSchema = z.object({
  tab: mirrorTabSchema,
  headers: z.array(z.string()),
  total_rows: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  rows: z.array(z.array(cellSchema)),
  freeze_id: z.string(),
  frozen_at: z.string().datetime(),
  schema_version: z.string(),
});
export async function exportGasSnapshot(
  call: GasOperatorCall,
  ownerId: string,
  freezeId: string,
): Promise<Snapshot> {
  const tabs: Snapshot['tabs'] = {};
  let frozenAt = '';
  let schemaVersion = '';
  for (const tab of TABS) {
    let offset = 0;
    let total = -1;
    const rows: z.infer<typeof cellSchema>[][] = [];
    let headers: string[] = [];
    do {
      const page = pageSchema.parse(
        await call('migration.exportPage', { freeze_id: freezeId, tab, offset, limit: 50 }),
      );
      if (
        page.freeze_id !== freezeId ||
        page.tab !== tab ||
        page.offset !== offset ||
        (total >= 0 && page.total_rows !== total) ||
        (offset > 0 && canonicalJson(headers) !== canonicalJson(page.headers)) ||
        (frozenAt && frozenAt !== page.frozen_at) ||
        (schemaVersion && schemaVersion !== page.schema_version) ||
        (!page.rows.length && offset < page.total_rows)
      )
        throw new Error('Snapshot source changed during export');
      frozenAt = page.frozen_at;
      schemaVersion = page.schema_version;
      total = page.total_rows;
      headers = page.headers;
      rows.push(...page.rows);
      offset += page.rows.length;
    } while (offset < total);
    if (rows.length !== total) throw new Error('Snapshot page count mismatch');
    tabs[tab] = { headers, rows, sha256: '' };
  }
  return sealSnapshot({
    format: 'voice-d1-snapshot-v1',
    owner_id: ownerId,
    freeze_id: freezeId,
    frozen_at: frozenAt,
    exported_at: new Date().toISOString(),
    schema_version: schemaVersion,
    tabs,
  });
}

type Tab = MirrorEntity['tab'];
type Row = Record<string, unknown>;
export interface MigrationPlan {
  snapshot: Snapshot;
  records: Record<Tab, Row[]>;
  quarantine: { tab: Tab; row: number; reason: string }[];
  generated_cards: string[];
}
const numeric = new Set([
  'times_asked',
  'repetitions',
  'interval_days',
  'ease_factor',
  'version',
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'learning_steps',
  'reps',
  'lapses',
  'row_version',
  'old_interval_days',
  'new_interval_days',
  'previous_version',
  'next_version',
  'desired_retention',
  'maximum_interval',
  'daily_new_card_limit',
  'daily_review_limit',
  'reminder_local_hour',
  'attempt_count',
]);
function decodeRow(headers: string[], cells: z.infer<typeof cellSchema>[]): Row {
  const row: Row = {};
  headers.forEach((key, i) => {
    if (key.startsWith('_mirror_') || key === '_snapshot_json') return;
    let value: unknown = cells[i];
    if (typeof value === 'string' && /^'[\s]*[=+\-@]/.test(value)) value = value.slice(1);
    if (numeric.has(key) && value !== '' && value !== null) {
      if (
        typeof value !== 'number' &&
        !(typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value))
      )
        throw new Error('Invalid numeric cell');
      value = Number(value);
      if (!Number.isFinite(value)) throw new Error('Invalid numeric cell');
    }
    if (['is_suspended', 'notifications_enabled'].includes(key)) {
      if (typeof value === 'string' && /^(true|false)$/i.test(value))
        value = value.toLowerCase() === 'true';
      if (typeof value !== 'boolean') throw new Error('Invalid boolean cell');
    }
    row[key] = value;
  });
  const encoded =
    cells[headers.indexOf('_snapshot_json')] || cells[headers.indexOf('_mirror_json')];
  if (typeof encoded === 'string' && encoded) {
    const original = z.record(cellSchema).parse(JSON.parse(encoded) as unknown);
    for (const [key, value] of Object.entries(row)) {
      if (!(key in original)) {
        if (value !== '' && value !== null)
          throw new Error('Snapshot metadata omits nonempty column');
        continue;
      }
      if (String(value ?? '') !== String(original[key] ?? ''))
        throw new Error('Snapshot metadata differs from displayed cells');
    }
    return original;
  }
  return row;
}
function validateRow(tab: Tab, row: Row): Row {
  if (tab === 'Words') {
    const word = vocabularyItemSchema.parse(row);
    for (const key of ['created_at', 'last_asked_at', 'due_at'])
      z.string()
        .datetime()
        .parse(word[key as keyof typeof word]);
    for (const value of [word.deleted_at, word.last_reviewed_at])
      if (value) z.string().datetime().parse(value);
    if (
      word.word_key !==
      [
        word.user_id,
        normalizeText(word.lemma),
        normalizeText(word.part_of_speech),
        normalizeText(word.sense_key),
      ].join('|')
    )
      throw new Error('Word key mismatch');
    return { ...row, ...word };
  }
  if (tab === 'Cards') return { ...row, ...fsrsCardSchema.parse(row) };
  if (tab === 'Events') {
    z.object({
      event_id: z.string().min(1),
      event_type: z.string().min(1),
      user_id: z.string(),
      entity_id: z.string(),
      occurred_at: z.string().datetime(),
      payload_hash: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
      result_json: z.string().min(2),
    }).parse(row);
    const schemas: Record<string, z.ZodType> = {
      'vocabulary.upsert': vocabularyCreateResponseSchema,
      'vocabulary.update': vocabularyItemSchema,
      'vocabulary.delete': z.object({ word_id: z.string(), deleted: z.boolean() }),
      'review.record': reviewSubmitResponseSchema,
      'user.preferences': z.object({ updated: z.boolean(), notifications_enabled: z.boolean() }),
    };
    const schema = schemas[String(row['event_type'])];
    if (!schema) throw new Error('Unsupported replay action');
    schema.parse(JSON.parse(String(row['result_json'])) as unknown);
    if (row['fingerprint_scheme'] !== undefined)
      z.enum(['gas-hmac-v1', 'd1-hmac-v1']).parse(row['fingerprint_scheme']);
  }
  if (tab === 'Reviews') {
    z.object({
      review_id: z.string().min(1),
      event_id: z.string().min(1),
      card_id: z.string().min(1),
      word_id: z.string().min(1),
      rating: z.enum(['again', 'hard', 'good', 'easy']),
      reviewed_at: z.string().datetime(),
      old_due_at: z.string().datetime(),
      new_due_at: z.string().datetime(),
      previous_version: z.number().int().positive(),
      next_version: z.number().int().positive(),
      previous_state: z.string(),
      next_state: z.string(),
      stability: z.number().nonnegative(),
      difficulty: z.number().min(0).max(10),
      review_log_json: z.string().min(2),
      previous_card_json: z.string().min(2),
      next_card_json: z.string().min(2),
    }).parse(row);
    const previous = fsrsCardSchema.parse(JSON.parse(String(row['previous_card_json'])) as unknown);
    const next = fsrsCardSchema.parse(JSON.parse(String(row['next_card_json'])) as unknown);
    const log = z
      .object({
        rating: z.number().int().min(1).max(4),
        state: z.number().int().min(0).max(3),
        due: z.string().datetime(),
        review: z.string().datetime(),
        stability: z.number().nonnegative(),
        difficulty: z.number().min(0).max(10),
        elapsed_days: z.number().nonnegative(),
        last_elapsed_days: z.number().nonnegative(),
        scheduled_days: z.number().nonnegative(),
        learning_steps: z.number().int().nonnegative(),
      })
      .parse(JSON.parse(String(row['review_log_json'])) as unknown);
    if (
      !Object.keys(log).length ||
      previous.card_id !== row['card_id'] ||
      next.card_id !== row['card_id'] ||
      previous.user_id !== row['user_id'] ||
      next.user_id !== row['user_id'] ||
      previous.word_id !== row['word_id'] ||
      next.word_id !== row['word_id'] ||
      previous.row_version !== row['previous_version'] ||
      next.row_version !== row['next_version'] ||
      next.row_version !== previous.row_version + 1 ||
      previous.due_at_utc !== row['old_due_at'] ||
      next.due_at_utc !== row['new_due_at'] ||
      previous.state !== row['previous_state'] ||
      next.state !== row['next_state'] ||
      next.stability !== row['stability'] ||
      next.difficulty !== row['difficulty']
    )
      throw new Error('Invalid review snapshots');
  }
  if (tab === 'Users') {
    if (
      typeof row['telegram_chat_id'] === 'number' &&
      Number.isSafeInteger(row['telegram_chat_id'])
    )
      row['telegram_chat_id'] = String(row['telegram_chat_id']);
    z.object({
      telegram_chat_id: z.string().regex(/^-?\d+$/),
      timezone: z.string(),
      notifications_enabled: z.boolean(),
      daily_review_limit: z.number().int().positive(),
      reminder_local_hour: z.number().int().min(0).max(23),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
    }).parse(row);
    row['version'] ??= 0;
  }
  if (tab === 'Settings') {
    const config: Row = row['scheduler_parameters_json']
      ? z.record(z.unknown()).parse(JSON.parse(String(row['scheduler_parameters_json'])) as unknown)
      : {};
    if (row['desired_retention'] !== '' && row['desired_retention'] !== undefined)
      config['request_retention'] = row['desired_retention'];
    if (row['maximum_interval'] !== '' && row['maximum_interval'] !== undefined)
      config['maximum_interval'] = row['maximum_interval'];
    if (row['timezone']) config['timezone'] = row['timezone'];
    fsrsConfigSchema.parse(config);
  }
  if (tab === 'DailyDispatchLog') {
    z.object({
      dispatch_id: z.string(),
      local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      status: z.enum(['claimed', 'sent', 'failed', 'unknown', 'skipped']),
      claimed_at: z.string().datetime(),
      sent_at: z.string(),
      message_id: z.union([z.string(), z.number()]),
      last_error: z.string(),
      attempt_count: z.number().int().nonnegative(),
      claim_token: z.string().min(1),
    }).parse(row);
    row['version'] ??= 0;
  }
  return row;
}

/** Validation is read-only. Any unresolved row blocks SQL generation/import. Raw backup stays intact. */
export async function planMigration(
  value: unknown,
  materializeLegacyCards = false,
): Promise<MigrationPlan> {
  const snapshot = await verifySnapshot(value);
  const records: Record<Tab, Row[]> = {
    Words: [],
    Cards: [],
    Reviews: [],
    Events: [],
    Settings: [],
    Users: [],
    DailyDispatchLog: [],
  };
  const quarantine: MigrationPlan['quarantine'] = [];
  const generated: string[] = [];
  const wordKeys = new Set<string>();
  for (const tab of TABS) {
    const table = snapshot.tabs[tab]!;
    const ids = new Set<string>();
    for (let i = 0; i < table.rows.length; i++) {
      try {
        const row = validateRow(tab, decodeRow(table.headers, table.rows[i]!));
        const id = z.string().min(1).parse(row[MIRROR_IDS[tab]]);
        if (row['user_id'] !== snapshot.owner_id || ids.has(id))
          throw new Error('Duplicate ID or foreign owner');
        ids.add(id);
        if (tab === 'Words') {
          const key = String(row['word_key']);
          if (wordKeys.has(key)) throw new Error('Duplicate Word key');
          wordKeys.add(key);
        }
        records[tab].push(row);
      } catch {
        quarantine.push({ tab, row: i + 2, reason: 'invalid_or_duplicate_row' });
      }
    }
  }
  const words = new Set(records.Words.map((w) => String(w['word_id'])));
  for (const card of records.Cards)
    if (!words.has(String(card['word_id'])))
      quarantine.push({ tab: 'Cards', row: 0, reason: 'orphan_word' });
  for (const word of records.Words) {
    if (word['deleted_at'] || records.Cards.some((c) => c['word_id'] === word['word_id'])) continue;
    if (!materializeLegacyCards) {
      quarantine.push({
        tab: 'Words',
        row: 0,
        reason: 'missing_card_requires_explicit_materialization',
      });
      continue;
    }
    const wordId = String(word['word_id']);
    const card = fsrsCardSchema.parse({
      ...createInitialFsrsCard({
        cardId: `c_${wordId}`,
        wordId,
        userId: snapshot.owner_id,
        nowIso: String(word['created_at']),
      }),
      due_at_utc: word['due_at'],
      scheduled_days: word['interval_days'],
      reps: word['repetitions'],
      last_review_at_utc: word['last_reviewed_at'] || null,
      row_version: word['version'],
      is_suspended: word['review_state'] === 'suspended',
      updated_at_utc: snapshot.frozen_at,
      scheduler_version: 'not-yet-scheduled',
      parameters_version: 'not-yet-scheduled',
      legacy_snapshot_json: canonicalJson(word),
    });
    records.Cards.push(card);
    generated.push(card.card_id);
  }
  const cards = new Map(records.Cards.map((c) => [c['card_id'], c]));
  const events = new Set(records.Events.map((e) => e['event_id']));
  const reviewEvents = new Set<unknown>();
  for (const review of records.Reviews) {
    if (
      !words.has(String(review['word_id'])) ||
      cards.get(review['card_id'])?.['word_id'] !== review['word_id'] ||
      !events.has(review['event_id']) ||
      reviewEvents.has(review['event_id'])
    )
      quarantine.push({ tab: 'Reviews', row: 0, reason: 'orphan_or_duplicate_event' });
    reviewEvents.add(review['event_id']);
  }
  for (const event of records.Events)
    if (event['event_type'] === 'review.record' && !reviewEvents.has(event['event_id']))
      quarantine.push({ tab: 'Events', row: 0, reason: 'missing_review_audit' });
  return { snapshot, records, quarantine, generated_cards: generated };
}

const TABLES: Record<Tab, string> = {
  Words: 'words',
  Cards: 'cards',
  Reviews: 'reviews',
  Events: 'events',
  Settings: 'settings',
  Users: 'users',
  DailyDispatchLog: 'daily_dispatches',
};
export function importStatements(db: DatabaseBinding, plan: MigrationPlan): Statement[] {
  if (plan.quarantine.length) throw new Error('Unresolved quarantine blocks import');
  const statements: Statement[] = [];
  for (const tab of [
    'Users',
    'Settings',
    'Words',
    'Cards',
    'Events',
    'Reviews',
    'DailyDispatchLog',
  ] as const) {
    for (const row of plan.records[tab]) {
      if (tab === 'Words') {
        // Import never updates an existing row: verify must reject a differing target.
        const word = vocabularyItemSchema.parse(row);
        statements.push(
          db
            .prepare('INSERT INTO words VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
            .bind(
              word.word_id,
              word.user_id,
              word.word_key,
              word.created_at,
              word.deleted_at,
              word.version,
              canonicalJson(row),
            ),
        );
      } else if (tab === 'Cards') {
        const card = fsrsCardSchema.parse(row);
        statements.push(
          db
            .prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
            .bind(
              card.card_id,
              card.user_id,
              card.word_id,
              card.due_at_utc,
              card.state,
              card.is_suspended ? 1 : 0,
              card.row_version,
              canonicalJson(row),
            ),
        );
      } else if (tab === 'Events')
        statements.push(
          db
            .prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
            .bind(
              row['event_id'],
              row['user_id'],
              row['event_type'],
              row['entity_id'],
              row['occurred_at'],
              row['payload_hash'],
              row['fingerprint_scheme'] ?? 'gas-hmac-v1',
              row['result_json'],
              canonicalJson(row),
            ),
        );
      else if (tab === 'Reviews')
        statements.push(
          db
            .prepare('INSERT INTO reviews VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
            .bind(
              row['review_id'],
              row['event_id'],
              row['user_id'],
              row['card_id'],
              row['word_id'],
              row['reviewed_at'],
              canonicalJson(row),
            ),
        );
      else if (tab === 'DailyDispatchLog')
        statements.push(
          db
            .prepare('INSERT INTO daily_dispatches VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
            .bind(
              row['dispatch_id'],
              row['user_id'],
              row['local_date'],
              row['status'],
              row['claim_token'],
              row['attempt_count'],
              canonicalJson(row),
            ),
        );
      else
        statements.push(
          db
            .prepare(`INSERT INTO ${TABLES[tab]} VALUES (?,?) ON CONFLICT DO NOTHING`)
            .bind(row['user_id'], canonicalJson(row)),
        );
    }
  }
  return statements;
}

/** Frozen target only; bounded atomic chunks and durable checkpoints make reruns safe after a crash. */
export async function importSnapshot(
  db: DatabaseBinding,
  plan: MigrationPlan,
  epoch: string,
): Promise<void> {
  z.string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .parse(epoch);
  if (plan.quarantine.length) throw new Error('Unresolved quarantine blocks import');
  if (
    (await db
      .prepare("SELECT value FROM system_state WHERE key='writes_enabled'")
      .first('value')) !== 'false'
  )
    throw new Error('Target writes must be frozen');
  const existing = await db
    .prepare('SELECT source_checksum FROM migration_runs WHERE migration_run_id=?')
    .bind(plan.snapshot.freeze_id)
    .first('source_checksum');
  if (existing && existing !== plan.snapshot.sha256) throw new Error('Migration manifest changed');
  const initialGuard = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO mutation_guards SELECT ?,CASE WHEN (SELECT value FROM system_state WHERE key='writes_enabled')='false'
      AND NOT EXISTS(SELECT 1 FROM migration_runs WHERE migration_run_id=? AND source_checksum!=?) THEN 1 ELSE 0 END`,
      )
      .bind(initialGuard, plan.snapshot.freeze_id, plan.snapshot.sha256),
    db
      .prepare("INSERT INTO migration_runs VALUES (?,?,'importing','{}',?) ON CONFLICT DO NOTHING")
      .bind(plan.snapshot.freeze_id, plan.snapshot.sha256, new Date().toISOString()),
    db
      .prepare("UPDATE migration_runs SET state='importing',updated_at=? WHERE migration_run_id=?")
      .bind(new Date().toISOString(), plan.snapshot.freeze_id),
    db.prepare('DELETE FROM mutation_guards WHERE guard_id=?').bind(initialGuard),
  ]);
  const statements = importStatements(db, plan);
  for (let i = 0; i < statements.length; i += 20) {
    const guard = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO mutation_guards SELECT ?,CASE WHEN (SELECT value FROM system_state WHERE key='writes_enabled')='false' THEN 1 ELSE 0 END",
        )
        .bind(guard),
      ...statements.slice(i, i + 20),
      db
        .prepare(
          'UPDATE migration_runs SET checkpoint_json=?,updated_at=? WHERE migration_run_id=?',
        )
        .bind(
          canonicalJson({ imported_statements: Math.min(i + 20, statements.length) }),
          new Date().toISOString(),
          plan.snapshot.freeze_id,
        ),
      db.prepare('DELETE FROM mutation_guards WHERE guard_id=?').bind(guard),
    ]);
  }
  const verified = await verifyImport(db, plan);
  if (!verified.ok) throw new Error('Imported data does not match manifest; keep writes frozen');
  const finalGuard = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO mutation_guards SELECT ?,CASE WHEN (SELECT value FROM system_state WHERE key='writes_enabled')='false' THEN 1 ELSE 0 END",
      )
      .bind(finalGuard),
    db.prepare("UPDATE system_state SET value=? WHERE key='source_epoch'").bind(epoch),
    db
      .prepare("UPDATE migration_runs SET state='verified' WHERE migration_run_id=?")
      .bind(plan.snapshot.freeze_id),
    db.prepare('DELETE FROM mutation_guards WHERE guard_id=?').bind(finalGuard),
  ]);
}

async function readD1Records(db: DatabaseBinding, table: string): Promise<Row[]> {
  const result: Row[] = [];
  let cursor = 0;
  while (true) {
    const rows = (
      await db
        .prepare(
          `SELECT rowid AS cursor,record_json FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 50`,
        )
        .bind(cursor)
        .all()
    ).results;
    if (!rows.length) return result;
    for (const row of rows) {
      result.push(z.record(z.unknown()).parse(JSON.parse(String(row['record_json'])) as unknown));
      cursor = Number(row['cursor']);
    }
  }
}

export async function verifyImport(db: DatabaseBinding, plan: MigrationPlan) {
  const mismatches: { tab: Tab; reason: string }[] = [];
  for (const tab of TABS) {
    const actual = await readD1Records(db, TABLES[tab]);
    const expected = [...plan.records[tab]].sort((a, b) =>
      String(a[MIRROR_IDS[tab]]).localeCompare(String(b[MIRROR_IDS[tab]]), 'en'),
    );
    // Compare ID maps rather than locale-specific order used by SQLite.
    const map = (rows: Row[]) =>
      Object.fromEntries(rows.map((r) => [String(r[MIRROR_IDS[tab]]), r]));
    if ((await hashJson(map(actual))) !== (await hashJson(map(expected))))
      mismatches.push({ tab, reason: 'record_hash_or_id_set_mismatch' });
  }
  const quick = await db.prepare('PRAGMA quick_check').all();
  const foreign = await db.prepare('PRAGMA foreign_key_check').all();
  const integrity =
    quick.results.every((row) => Object.values(row).every((v) => v === 'ok')) &&
    !foreign.results.length;
  return { ok: !plan.quarantine.length && !mismatches.length && integrity, mismatches, integrity };
}

/** Full D1 backup for reverse migration into a separate frozen GAS target. */
export async function exportD1Snapshot(
  db: DatabaseBinding,
  ownerId: string,
  freezeId: string,
  frozenAt: string,
): Promise<Snapshot> {
  if (
    (await db
      .prepare("SELECT value FROM system_state WHERE key='writes_enabled'")
      .first('value')) !== 'false'
  )
    throw new Error('Freeze D1 writes before export');
  const tabs: Snapshot['tabs'] = {};
  for (const tab of TABS) {
    const rows = (await readD1Records(db, TABLES[tab])).map((row) =>
      z.record(cellSchema).parse(row),
    );
    if (rows.some((r) => r['user_id'] !== ownerId)) throw new Error('Foreign owner in D1 backup');
    const headers = [
      ...new Set([
        ...EMPTY_HEADERS[tab].split(','),
        ...rows.flatMap((r) => Object.keys(r)),
        '_snapshot_json',
      ]),
    ];
    tabs[tab] = {
      headers,
      rows: rows.map((r) =>
        headers.map((key) => (key === '_snapshot_json' ? canonicalJson(r) : (r[key] ?? ''))),
      ),
      sha256: '',
    };
  }
  return sealSnapshot({
    format: 'voice-d1-snapshot-v1',
    owner_id: ownerId,
    freeze_id: freezeId,
    frozen_at: frozenAt,
    exported_at: new Date().toISOString(),
    schema_version: 'd1-v1',
    tabs,
  });
}

export async function restoreGasSnapshot(
  call: GasOperatorCall,
  value: unknown,
  targetFreezeId: string,
): Promise<void> {
  const snapshot = await verifySnapshot(value);
  for (const tab of TABS) {
    const table = snapshot.tabs[tab]!;
    for (let offset = 0; offset < Math.max(1, table.rows.length); offset += 1) {
      // Full audit rows may be large; one row/body still bounded to 60 KB by the signer.
      await call('migration.restoreBatch', {
        freeze_id: targetFreezeId,
        tab,
        headers: table.headers,
        rows: table.rows.slice(offset, offset + 1),
      });
    }
  }
}
