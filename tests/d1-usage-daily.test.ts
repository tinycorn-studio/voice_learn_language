// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createD1RuntimeHarness } from './d1-runtime-harness.js';
import { D1RepositoryAdapter } from '../apps/worker/src/adapters/d1-repository.js';

const USER = 'telegram:123';
const runtimes: Awaited<ReturnType<typeof createD1RuntimeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});

async function setup() {
  const runtime = await createD1RuntimeHarness();
  runtimes.push(runtime);
  const repo = new D1RepositoryAdapter(runtime.db, 'synthetic_shared_secret_key_0000001');
  return { db: runtime.db, repo };
}

const nowIso = () => new Date().toISOString();

describe('M9-03 daily usage caps', () => {
  it('increments and enforces the cap atomically per user, kind, and local day', async () => {
    const { repo } = await setup();
    const consume = (cap: number, localDate = '2026-10-12') =>
      repo.checkAndConsumeUsage({
        userId: USER,
        kind: 'chat_turn',
        cap,
        localDate,
        nowIso: nowIso(),
      });

    expect(await consume(2)).toEqual({ allowed: true, used: 1, cap: 2 });
    expect(await consume(2)).toEqual({ allowed: true, used: 2, cap: 2 });
    expect(await consume(2)).toEqual({ allowed: false, used: 2, cap: 2 });
    // A new local day resets the counter without deleting history.
    expect(await consume(2, '2026-10-13')).toEqual({ allowed: true, used: 1, cap: 2 });
    // Other kinds and users keep independent counters.
    expect(
      await repo.checkAndConsumeUsage({
        userId: 'telegram:999',
        kind: 'chat_turn',
        cap: 2,
        localDate: '2026-10-12',
        nowIso: nowIso(),
      }),
    ).toEqual({ allowed: true, used: 1, cap: 2 });
  });

  it('keeps concurrent isolates from overshooting the cap', async () => {
    const { repo } = await setup();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        repo.checkAndConsumeUsage({
          userId: USER,
          kind: 'live_session',
          cap: 3,
          localDate: '2026-10-12',
          nowIso: nowIso(),
        }),
      ),
    );
    expect(attempts.filter((result) => result.allowed)).toHaveLength(3);
    expect(attempts.filter((result) => !result.allowed)).toHaveLength(5);
  });

  it('treats cap = 0 as feature-disabled without writing a counter', async () => {
    const { db, repo } = await setup();
    const outcome = await repo.checkAndConsumeUsage({
      userId: USER,
      kind: 'translation',
      cap: 0,
      localDate: '2026-10-12',
      nowIso: nowIso(),
    });
    expect(outcome).toEqual({ allowed: false, used: 0, cap: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM usage_daily').first()).toEqual({ n: 0 });
  });
});
