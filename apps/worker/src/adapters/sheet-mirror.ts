import { z } from 'zod';
import {
  canonicalJson,
  mirrorBatchSchema,
  mirrorJobSchema,
  type MirrorEntity,
} from '@voice-chat/shared';
import { logStructured, type WorkerEnv } from '../domain/env.js';
import type { DatabaseBinding } from './d1-database.js';
import { signGasPayload } from './gas-client.js';

const jobRowSchema = z.object({
  sequence: z.number().int(),
  event_id: z.string(),
  payload_json: z.string(),
  attempts: z.number().int(),
});
const ackSchema = z.object({
  ok: z.literal(true),
  data: z.object({ applied_event_ids: z.array(z.string()) }),
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });

/**
 * Composes the `mirror.applyBatch` envelope in canonical (alphabetical) key order while reusing
 * the stored `payload_json` verbatim, so retries no longer re-canonicalize the snapshot tree
 * (`M9-03`). Signed bytes stay byte-identical to `canonicalJson` envelopes when the stored
 * payload is already canonical.
 */
export function composeMirrorEnvelopePayload(params: {
  sequence: number;
  token: string;
  issuedAt: string;
  ownerUserId: string;
  epoch: string;
  payloadJson: string;
}): string {
  return (
    `{"action":"mirror.applyBatch","data":{"epoch":${JSON.stringify(params.epoch)},"jobs":[${params.payloadJson}]}` +
    `,"event_id":${JSON.stringify(`mirror_${params.sequence}_${params.token}`)}` +
    `,"issued_at":${JSON.stringify(params.issuedAt)}` +
    `,"request_id":${JSON.stringify(`mirror_${params.sequence}`)}` +
    `,"user_id":${JSON.stringify(params.ownerUserId)}}`
  );
}

/** Independent of API persistence; retries re-sign the same immutable job with a fresh timestamp. */
export async function processSheetMirror(
  db: DatabaseBinding,
  env: WorkerEnv,
  now: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  if (env.SHEET_MIRROR_ENABLED !== 'true') return 0;
  if (
    (await db.prepare("SELECT value FROM system_state WHERE key='source_epoch'").first('value')) !==
    env.SHEET_MIRROR_EPOCH
  )
    throw new Error('Mirror source epoch mismatch');
  const token = crypto.randomUUID();
  const until = new Date(Date.parse(now) + 60_000).toISOString();
  const lease = await db
    .prepare(
      'UPDATE sync_processor_lease SET lease_token=?,lease_until=? WHERE singleton=1 AND lease_until<=?',
    )
    .bind(token, until, now)
    .run();
  if (!lease.meta.changes) return 0;
  let delivered = 0;
  try {
    // One event can include several full snapshots. One job/tick bounds Free subrequests
    // alongside Telegram/digest, and avoids retrying a partial multi-job GAS acknowledgement.
    const raw = await db
      .prepare(
        `SELECT sequence,event_id,payload_json,attempts FROM sync_outbox
      WHERE (status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?) ORDER BY sequence LIMIT 1`,
      )
      .bind(now, now)
      .first();
    if (!raw) return 0;
    const job = jobRowSchema.parse(raw);
    const claimed = await db
      .prepare(
        `UPDATE sync_outbox SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1
      WHERE sequence=? AND ((status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?))`,
      )
      .bind(token, until, job.sequence, now, now)
      .run();
    if (!claimed.meta.changes) return 0;
    let errorCode = 'transient';
    let permanent = false;
    try {
      const value = mirrorJobSchema.parse(JSON.parse(job.payload_json) as unknown);
      // Epoch is validated with the same schema as before, but the job tree is not re-parsed
      // through `mirrorBatchSchema` (`M9-03`): it was already validated above and re-validating
      // the whole snapshot tree doubled CPU per attempt.
      const epoch = mirrorBatchSchema.shape.epoch.parse(env.SHEET_MIRROR_EPOCH);
      const ownerUserId = `telegram:${env.OWNER_TELEGRAM_ID.trim()}`;
      if (
        value.event_id !== job.event_id ||
        value.entities.some((e) => e.row['user_id'] !== ownerUserId)
      )
        throw new Error('Invalid mirror owner');
      const payload = composeMirrorEnvelopePayload({
        sequence: job.sequence,
        token,
        issuedAt: now,
        ownerUserId,
        epoch,
        payloadJson: job.payload_json,
      });
      if (payload.length > 60000) throw new Error('Oversized mirror job');
      const signature = await signGasPayload(payload, env.GAS_SHARED_SECRET);
      const response = await fetchFn.call(globalThis, env.GAS_EXEC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload, signature }),
        signal: AbortSignal.timeout(15000),
      });
      const body: unknown = await response.json();
      const ack = ackSchema.safeParse(body);
      if (
        response.ok &&
        ack.success &&
        ack.data.data.applied_event_ids.length === 1 &&
        ack.data.data.applied_event_ids[0] === job.event_id
      ) {
        delivered = 1;
      } else {
        const code = errorSchema.safeParse(body);
        errorCode =
          code.success &&
          ['CONFLICT', 'FORBIDDEN', 'INVALID_MIRROR', 'NOT_CONFIGURED'].includes(
            code.data.error.code,
          )
            ? code.data.error.code
            : 'transient';
        permanent = ['CONFLICT', 'FORBIDDEN', 'INVALID_MIRROR'].includes(errorCode);
      }
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        (error instanceof Error &&
          ['Invalid mirror owner', 'Oversized mirror job'].includes(error.message))
      ) {
        permanent = true;
        errorCode = 'invalid_payload';
      }
      // Network errors, malformed JSON and missing ACK remain retryable; log no signed body.
    }
    const dead = !delivered && (permanent || job.attempts + 1 >= 8);
    const next = new Date(
      Date.parse(now) + Math.min(3600_000, 30_000 * 2 ** job.attempts) * (1 + Math.random() * 0.2),
    ).toISOString();
    // Final outbox update and lease release share one batched round trip (`M9-03`); the
    // `finally` below still releases the lease as a safety net for earlier failures.
    await db.batch([
      db
        .prepare(
          `UPDATE sync_outbox SET status=?,next_attempt_at=?,delivered_at=?,last_error=?,lease_token='',lease_until=''
      WHERE sequence=? AND lease_token=?`,
        )
        .bind(
          delivered ? 'delivered' : dead ? 'dead' : 'pending',
          next,
          delivered ? now : '',
          delivered ? '' : errorCode,
          job.sequence,
          token,
        ),
      db
        .prepare(
          "UPDATE sync_processor_lease SET lease_token='',lease_until='' WHERE singleton=1 AND lease_token=?",
        )
        .bind(token),
    ]);
    logStructured(delivered ? 'info' : 'warn', 'sheet_mirror_result', `mirror_${job.sequence}`, {
      delivered: !!delivered,
      dead,
      attempt: job.attempts + 1,
    });
  } finally {
    await db
      .prepare(
        "UPDATE sync_processor_lease SET lease_token='',lease_until='' WHERE singleton=1 AND lease_token=?",
      )
      .bind(token)
      .run();
  }
  return delivered;
}

/** Queue health without returning content or user identifiers. */
export async function getMirrorHealth(db: DatabaseBinding, now: string) {
  const counts = await db
    .prepare(
      'SELECT status,COUNT(*) AS count,MIN(committed_at) AS oldest FROM sync_outbox GROUP BY status',
    )
    .all();
  return counts.results.map((row) => ({
    status: String(row['status']),
    count: Number(row['count']),
    oldest_age_ms: Math.max(0, Date.parse(now) - Date.parse(String(row['oldest']))),
  }));
}

/** Explicit operator recovery after fixing a cause; dead jobs are never discarded. */
export async function requeueMirrorJob(
  db: DatabaseBinding,
  eventId: string,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE sync_outbox SET status='pending',attempts=0,next_attempt_at=?,last_error='' WHERE event_id=? AND status='dead'",
    )
    .bind(now, eventId)
    .run();
  return result.meta.changes === 1;
}

/** Resumable operator rebuild. Freeze authority writes and set a fresh Sheet epoch first. */
export async function enqueueMirrorRebuild(
  db: DatabaseBinding,
  epoch: string,
  now: string,
): Promise<number> {
  mirrorBatchSchema.shape.epoch.parse(epoch);
  if (
    (await db
      .prepare("SELECT value FROM system_state WHERE key='writes_enabled'")
      .first('value')) !== 'false'
  )
    throw new Error('Freeze D1 writes before mirror rebuild');
  const tables = {
    Words: 'words',
    Cards: 'cards',
    Reviews: 'reviews',
    Events: 'events',
    Settings: 'settings',
    Users: 'users',
    DailyDispatchLog: 'daily_dispatches',
  } as const;
  let enqueued = 0;
  for (const [tab, table] of Object.entries(tables)) {
    let cursor = 0;
    while (true) {
      const rows = await db
        .prepare(
          `SELECT rowid AS cursor,record_json FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 50`,
        )
        .bind(cursor)
        .all();
      if (!rows.results.length) break;
      for (const raw of rows.results) {
        const row = z.record(z.unknown()).parse(JSON.parse(String(raw['record_json'])) as unknown);
        const idColumn = {
          Words: 'word_id',
          Cards: 'card_id',
          Reviews: 'review_id',
          Events: 'event_id',
          Settings: 'user_id',
          Users: 'user_id',
          DailyDispatchLog: 'dispatch_id',
        }[tab];
        const version =
          tab === 'Cards'
            ? Number(row['row_version'])
            : tab === 'Reviews' || tab === 'Events'
              ? 1
              : Number(row['version'] ?? 0);
        const entity: MirrorEntity = {
          tab: tab as MirrorEntity['tab'],
          id: String(row[idColumn!]),
          version,
          row,
        };
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(canonicalJson({ epoch, entity })),
        );
        const eventId = `rebuild_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        const job = mirrorJobSchema.parse({ event_id: eventId, entities: [entity] });
        const result = await db
          .prepare(
            `INSERT INTO sync_outbox(event_id,payload_json,committed_at,next_attempt_at)
          SELECT ?,?,?,? WHERE (SELECT value FROM system_state WHERE key='writes_enabled')='false'
          ON CONFLICT(event_id) DO NOTHING`,
          )
          .bind(eventId, canonicalJson(job), now, now)
          .run();
        enqueued += result.meta.changes;
        cursor = Number(raw['cursor']);
      }
    }
  }
  return enqueued;
}
