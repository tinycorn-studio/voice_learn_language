// @vitest-environment node
import { afterAll, expect, it } from 'vitest';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';

const runtimePromise = createD1RuntimeHarness();
afterAll(async () => (await runtimePromise).dispose());

it('measures local sequential versus batched D1 preflight reads', async () => {
  const { db } = await runtimePromise;
  const eventRead = db.prepare('SELECT event_id FROM events WHERE event_id=?').bind('bench');
  const wordRead = db.prepare('SELECT record_json FROM words WHERE word_key=?').bind('bench');
  const serial = async () => {
    await eventRead.first();
    await wordRead.first();
  };
  const batched = async () => db.batch([eventRead, wordRead]);
  const measure = async (operation: () => Promise<unknown>) => {
    const started = performance.now();
    await operation();
    return performance.now() - started;
  };
  const percentile = (samples: number[], p: number) =>
    [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1]!;

  for (let i = 0; i < 10; i++) {
    await serial();
    await batched();
  }
  const serialMs: number[] = [];
  const batchedMs: number[] = [];
  for (let i = 0; i < 30; i++) {
    serialMs.push(await measure(serial));
    batchedMs.push(await measure(batched));
  }
  console.info(
    `M8-02_BENCHMARK ${JSON.stringify({
      runtime: 'local Miniflare/workerd D1, in-memory synthetic data',
      samples: 30,
      baseline_sequential_round_trips: 2,
      candidate_batched_round_trips: 1,
      baseline_ms: { p50: percentile(serialMs, 0.5), p95: percentile(serialMs, 0.95) },
      candidate_ms: { p50: percentile(batchedMs, 0.5), p95: percentile(batchedMs, 0.95) },
    })}`,
  );
  expect(serialMs).toHaveLength(30);
  expect(batchedMs).toHaveLength(30);
});
