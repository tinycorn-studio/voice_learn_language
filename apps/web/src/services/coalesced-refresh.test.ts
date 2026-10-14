import { expect, it, vi } from 'vitest';
import { CoalescedRefresh } from './coalesced-refresh.js';

it('merges a burst and re-reads after a mutation arriving during an in-flight read', async () => {
  let release!: () => void;
  const load = vi
    .fn<(_keys: readonly string[]) => Promise<void>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const refresh = new CoalescedRefresh(load);
  const first = refresh.request(['vocabulary']);
  refresh.request(['vocabulary', 'review']);
  await Promise.resolve();
  expect(load).toHaveBeenCalledExactlyOnceWith(['vocabulary', 'review']);
  refresh.request(['vocabulary']);
  release();
  await first;
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenLastCalledWith(['vocabulary']);
});
