// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { canonicalJson, mirrorBatchSchema, mirrorJobSchema } from '@voice-chat/shared';
import {
  composeMirrorEnvelopePayload,
  processSheetMirror,
} from '../apps/worker/src/adapters/sheet-mirror.js';
import {
  signGasPayload,
  verifyGasPayloadSignature,
} from '../apps/worker/src/adapters/gas-client.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';

const runtimePromise = createD1RuntimeHarness();
afterAll(async () => (await runtimePromise).dispose());

const SECRET = 'm9-03-synthetic-secret';
const USER = 'telegram:123';
const ENV: WorkerEnv = {
  DATA_BACKEND: 'd1',
  SHEET_MIRROR_ENABLED: 'true',
  SHEET_MIRROR_EPOCH: 'bench_epoch',
  OWNER_TELEGRAM_ID: '123',
  GEMINI_API_KEY: 'synthetic',
  TELEGRAM_BOT_TOKEN: 'synthetic',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic',
  GAS_SHARED_SECRET: SECRET,
  GAS_EXEC_URL: 'https://gas.example/exec',
};

function syntheticJob(entityCount = 4): z.infer<typeof mirrorJobSchema> {
  const longText = 'lorem ipsum dolor sit amet '.repeat(80);
  const entities = Array.from({ length: entityCount }, (_, index) => ({
    tab: 'Words' as const,
    id: `bench_word_${index}`,
    version: 1,
    row: {
      word_id: `bench_word_${index}`,
      user_id: USER,
      word_key: `bench word ${index}`,
      word: `benchword${index}`,
      lemma: `benchword${index}`,
      part_of_speech: 'noun',
      sense_key: 'default',
      meaning_vi: longText,
      ipa: '/bɛntʃ/',
      example: longText.slice(0, 400),
      source_excerpt: longText.slice(0, 300),
      created_at: '2026-10-17T00:00:00.000Z',
      last_asked_at: '2026-10-17T00:00:00.000Z',
      times_asked: 0,
      review_state: 'new',
      repetitions: 0,
      interval_days: 0,
      ease_factor: 2.5,
      due_at: '2026-10-17T00:00:00.000Z',
      last_reviewed_at: '',
      version: 1,
      deleted_at: '',
      notes: longText.slice(0, 2000),
      extra: longText.slice(0, 1000),
    },
  }));
  return mirrorJobSchema.parse({ event_id: 'bench_event_0001', entities });
}

function legacySyncPath(payloadJson: string, epoch: string, now: string): string {
  const value = mirrorJobSchema.parse(JSON.parse(payloadJson) as unknown);
  const data = mirrorBatchSchema.parse({ epoch, jobs: [value] });
  return canonicalJson({
    action: 'mirror.applyBatch',
    event_id: `mirror_${1}_token`,
    issued_at: now,
    user_id: USER,
    request_id: `mirror_${1}`,
    data,
  });
}

function optimizedSyncPath(payloadJson: string, epoch: string, now: string): string {
  const value = mirrorJobSchema.parse(JSON.parse(payloadJson) as unknown);
  const parsedEpoch = mirrorBatchSchema.shape.epoch.parse(epoch);
  if (value.entities.some((e) => e.row['user_id'] !== USER)) throw new Error('Invalid mirror owner');
  return composeMirrorEnvelopePayload({
    sequence: 1,
    token: 'token',
    issuedAt: now,
    ownerUserId: USER,
    epoch: parsedEpoch,
    payloadJson,
  });
}

const percentile = (samples: number[], p: number) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1]!;

describe('M9-03 mirror CPU optimizations', () => {
  it('composes envelopes byte-identical to canonicalJson for canonical payloads', () => {
    const job = syntheticJob(2);
    const payloadJson = canonicalJson(job);
    const composed = composeMirrorEnvelopePayload({
      sequence: 7,
      token: 'token-1',
      issuedAt: '2026-10-17T00:00:00.000Z',
      ownerUserId: USER,
      epoch: ENV.SHEET_MIRROR_EPOCH!,
      payloadJson,
    });
    const canonical = canonicalJson({
      action: 'mirror.applyBatch',
      event_id: 'mirror_7_token-1',
      issued_at: '2026-10-17T00:00:00.000Z',
      user_id: USER,
      request_id: 'mirror_7',
      data: mirrorBatchSchema.parse({ epoch: ENV.SHEET_MIRROR_EPOCH, jobs: [job] }),
    });
    expect(composed).toBe(canonical);
  });

  it('keeps signatures verifiable for JSON.stringify-stored payloads', async () => {
    const job = syntheticJob(1);
    const payloadJson = JSON.stringify(job);
    expect(payloadJson).not.toBe(canonicalJson(job));
    const payload = composeMirrorEnvelopePayload({
      sequence: 3,
      token: 'token-2',
      issuedAt: '2026-10-17T00:00:00.000Z',
      ownerUserId: USER,
      epoch: ENV.SHEET_MIRROR_EPOCH!,
      payloadJson,
    });
    const signature = await signGasPayload(payload, SECRET);
    await expect(verifyGasPayloadSignature(payload, signature, SECRET)).resolves.toBe(true);
    const parsed = JSON.parse(payload) as { data: unknown };
    expect(parsed.data).toEqual({ epoch: ENV.SHEET_MIRROR_EPOCH, jobs: [job] });
  });

  it('cached HMAC keys return identical signatures to a fresh import', async () => {
    const payload = '{"action":"mirror.applyBatch"}';
    const fresh = await (async () => {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
      return Buffer.from(new Uint8Array(sig)).toString('base64url');
    })();
    const first = await signGasPayload(payload, SECRET);
    const second = await signGasPayload(payload, SECRET);
    expect(first).toBe(fresh);
    expect(second).toBe(fresh);
  });

  it('processSheetMirror still delivers with the composed envelope', { timeout: 20000 }, async () => {
    {
      const { db } = await runtimePromise;
      await db
        .prepare("UPDATE system_state SET value=? WHERE key='source_epoch'")
        .bind(ENV.SHEET_MIRROR_EPOCH!)
        .run();
      const job = mirrorJobSchema.parse(syntheticJob(1));
      await db
        .prepare("INSERT INTO sync_outbox(event_id,payload_json,committed_at,next_attempt_at) VALUES (?,?,?,?)")
        .bind(
          job.event_id,
          JSON.stringify(job),
          '2026-10-17T00:00:00.000Z',
          '2026-10-17T00:00:00.000Z',
        )
        .run();
      const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { payload: string; signature: string };
        expect(JSON.parse(body.payload)).toMatchObject({ action: 'mirror.applyBatch' });
        await expect(
          verifyGasPayloadSignature(body.payload, body.signature, SECRET),
        ).resolves.toBe(true);
        return Response.json({ ok: true, data: { applied_event_ids: [job.event_id] } });
      });
      expect(
        await processSheetMirror(db, ENV, '2026-10-17T00:00:01.000Z', fetchFn as unknown as typeof fetch),
      ).toBe(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it('benchmarks legacy versus optimized per-job CPU path locally', async () => {
    const payloadJson = canonicalJson(syntheticJob(4));
    const now = '2026-10-17T00:00:00.000Z';
    const samples = 60;
    for (let i = 0; i < 5; i++) {
      legacySyncPath(payloadJson, ENV.SHEET_MIRROR_EPOCH!, now);
      optimizedSyncPath(payloadJson, ENV.SHEET_MIRROR_EPOCH!, now);
    }
    const legacyMs: number[] = [];
    const optimizedMs: number[] = [];
    for (let i = 0; i < samples; i++) {
      let started = performance.now();
      legacySyncPath(payloadJson, ENV.SHEET_MIRROR_EPOCH!, now);
      legacyMs.push(performance.now() - started);
      started = performance.now();
      optimizedSyncPath(payloadJson, ENV.SHEET_MIRROR_EPOCH!, now);
      optimizedMs.push(performance.now() - started);
    }
    const legacyP50 = percentile(legacyMs, 0.5);
    const optimizedP50 = percentile(optimizedMs, 0.5);
    const signCached: number[] = [];
    const signFresh: number[] = [];
    const legacyPayload = legacySyncPath(payloadJson, ENV.SHEET_MIRROR_EPOCH!, now);
    const freshImportSign = async () => {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(legacyPayload));
    };
    for (let i = 0; i < 20; i++) {
      let started = performance.now();
      await freshImportSign();
      signFresh.push(performance.now() - started);
      started = performance.now();
      await signGasPayload(legacyPayload, SECRET);
      signCached.push(performance.now() - started);
    }
    console.info(
      `M9-03_BENCHMARK ${JSON.stringify({
        runtime: 'local Node 22, synthetic mirror job',
        payload_bytes: payloadJson.length,
        samples,
        legacy_sync_path_ms: { p50: legacyP50, p95: percentile(legacyMs, 0.95) },
        optimized_sync_path_ms: { p50: optimizedP50, p95: percentile(optimizedMs, 0.95) },
        sign_wall_ms: {
          fresh_import_p50: percentile(signFresh, 0.5),
          cached_p50: percentile(signCached, 0.5),
        },
      })}`,
    );
    expect(legacyMs).toHaveLength(samples);
    expect(optimizedMs).toHaveLength(samples);
    expect(optimizedP50).toBeLessThan(legacyP50);
  }, 30000);
});
