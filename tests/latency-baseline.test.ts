import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { GasRepositoryAdapter } from '../apps/worker/src/adapters/gas-client.js';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';

it('records a 30-operation synthetic GAS baseline separately from production latency', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  try {
    const gas = createGasRuntimeHarness({
      SHEET_ID: 'synthetic',
      GAS_SHARED_SECRET: 'synthetic-secret',
      OWNER_USER_ID: 'telegram:123',
    });
    gas.setupSheets();
    let calls = 0;
    const repo = new GasRepositoryAdapter(
      'https://synthetic.invalid',
      'synthetic-secret',
      async (_url, init) => {
        calls++;
        return new Response(gas.doPost(String(init?.body)).bodyText);
      },
    );
    const create: number[] = [];
    const review: number[] = [];
    for (let index = 0; index < 30; index++) {
      const started = performance.now();
      const word = await repo.upsert('telegram:123', `baseline-create-${index}`, {
        event_id: `baseline-word-${index}`,
        word: `synthetic${index}`,
        lemma: `synthetic${index}`,
        part_of_speech: 'noun',
        sense_key: 'default',
        meaning_vi: 'từ thử nghiệm',
        example: '',
        source_excerpt: '',
      });
      create.push(performance.now() - started);
      const reviewStarted = performance.now();
      await repo.recordReview(
        'telegram:123',
        `baseline-review-${index}`,
        {
          event_id: `baseline-rating-${index}`,
          card_id: `c_${word.word_id}`,
          rating: 'good',
          expected_version: 1,
        },
        '2026-10-13T11:00:00.000Z',
      );
      review.push(performance.now() - reviewStarted);
    }
    const summarize = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return { count: samples.length, p50_ms: sorted[14], p95_ms: sorted[28], max_ms: sorted[29] };
    };
    expect(calls).toBe(120);
    expect(gas.spreadsheet.getSheetByName('Reviews')!.getLastRow()).toBe(31);
    mkdirSync('.artifacts/M7-01', { recursive: true });
    writeFileSync(
      '.artifacts/M7-01/baseline.json',
      JSON.stringify(
        {
          environment: 'synthetic GAS VM, no network or real Sheets; not production benchmark',
          create: summarize(create),
          review: summarize(review),
          upstream_calls_per_create: 1,
          upstream_calls_per_new_review: 3,
        },
        null,
        2,
      ),
    );
  } finally {
    log.mockRestore();
  }
});
