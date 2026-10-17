import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { VocabularyCreateRequest } from '@voice-chat/shared';
import {
  createIndexedDbQueuePersistence,
  QUEUE_STORAGE_TTL_MS,
  type QueuePersistence,
} from './durable-queue-storage.js';
import { VocabularySaveQueue, type QueuedVocabularyEntry } from './vocabulary-save-queue.js';

function makeRequest(eventId: string, word = 'apple'): VocabularyCreateRequest {
  return {
    event_id: eventId,
    word,
    part_of_speech: 'noun',
    sense_key: 'default',
    meaning_vi: 'táo',
    example: '',
    source_excerpt: '',
  };
}

function makeEntry(
  eventId: string,
  status: 'pending' | 'failed' = 'pending',
  attempts = 1,
): QueuedVocabularyEntry {
  return {
    request: makeRequest(eventId),
    status,
    attempts,
    lastError: status === 'failed' ? 'offline' : null,
    wordId: null,
  };
}

const savedEntry: QueuedVocabularyEntry = {
  request: makeRequest('evt-saved-0000001'),
  status: 'saved',
  attempts: 1,
  lastError: null,
  wordId: 'word-1',
};

function uniqueDbName(label: string): string {
  return `test-queue-${label}-${Math.random().toString(36).slice(2)}`;
}

async function openRaw(dbName: string): Promise<IDBDatabase> {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('entries')) {
        request.result.createObjectStore('entries', { keyPath: 'entry.request.event_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('durable queue persistence (M9-01)', () => {
  it('roundtrips pending/failed entries and drops saved ones', async () => {
    const persistence = createIndexedDbQueuePersistence({ dbName: uniqueDbName('roundtrip') });
    expect(persistence).not.toBeNull();
    await persistence!.save([makeEntry('evt-alpha-000001'), savedEntry, makeEntry('evt-beta-0000002', 'failed', 2)]);

    const restored = await persistence!.load();
    expect(restored).toHaveLength(2);
    const byId = new Map(restored.map((entry) => [entry.request.event_id, entry]));
    expect(byId.get('evt-alpha-000001')?.status).toBe('pending');
    expect(byId.get('evt-beta-0000002')?.status).toBe('failed');
    expect(byId.get('evt-beta-0000002')?.attempts).toBe(2);
    expect(byId.has('evt-saved-0000001')).toBe(false);
  });

  it('expires entries older than the TTL and keeps fresh ones', async () => {
    let clock = 1_000_000;
    const ttlMs = 1000;
    const persistence = createIndexedDbQueuePersistence({
      dbName: uniqueDbName('ttl'),
      ttlMs,
      now: () => clock,
    });
    await persistence!.save([makeEntry('evt-fresh-0000001')]);

    clock += ttlMs - 1;
    expect(await persistence!.load()).toHaveLength(1);

    clock += 2;
    expect(await persistence!.load()).toHaveLength(0);
  });

  it('defaults to a bounded multi-day TTL', () => {
    expect(QUEUE_STORAGE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('ignores corrupt records and keeps valid ones', async () => {
    const dbName = uniqueDbName('corrupt');
    const persistence = createIndexedDbQueuePersistence({ dbName });
    await persistence!.save([makeEntry('evt-good-00000001')]);
    const db = await openRaw(dbName);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({
        version: 7,
        updated_at_ms: 0,
        entry: { request: { event_id: 'evt-bad-version-01' }, attempts: 1 },
      });
      tx.objectStore('entries').put({
        version: 1,
        updated_at_ms: Date.now(),
        entry: {
          request: makeRequest('evt-neg-attempts-01'),
          status: 'pending',
          attempts: -1,
          last_error: null,
          word_id: null,
        },
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const restored = await persistence!.load();
    expect(restored.map((entry) => entry.request.event_id)).toEqual(['evt-good-00000001']);
  });

  it('returns null when IndexedDB is unavailable', () => {
    const scope = globalThis as { indexedDB?: IDBFactory };
    const original = scope.indexedDB;
    scope.indexedDB = undefined;
    try {
      expect(createIndexedDbQueuePersistence()).toBeNull();
    } finally {
      scope.indexedDB = original;
    }
  });
});

describe('VocabularySaveQueue with persistence (M9-01)', () => {
  it('restores pending entries across queue instances and clears them after save', async () => {
    const persistence = createIndexedDbQueuePersistence({ dbName: uniqueDbName('queue') })!;
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    const first = new VocabularySaveQueue(offline, 25, persistence);
    await first.enqueueAndAttempt(makeRequest('evt-one-000000001'));
    await first.flushPersistence();

    const second = new VocabularySaveQueue(offline, 25, persistence);
    const restored = await second.hydrate();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.request.event_id).toBe('evt-one-000000001');
    expect(restored[0]?.attempts).toBe(1);
    expect(restored[0]?.lastError).toBe('offline');

    const online = vi.fn().mockResolvedValue({
      ok: true as const,
      data: { word_id: 'word-1', created: true, duplicate_event: false },
    });
    const third = new VocabularySaveQueue(online, 25, persistence);
    await third.hydrate();
    const retried = await third.retryPending();
    expect(retried[0]?.status).toBe('saved');
    await third.flushPersistence();

    const fourth = new VocabularySaveQueue(online, 25, persistence);
    expect(await fourth.hydrate()).toHaveLength(0);
  });

  it('keeps working when persistence load/save throw', async () => {
    const broken: QueuePersistence = {
      load: vi.fn().mockRejectedValue(new Error('load boom')),
      save: vi.fn().mockRejectedValue(new Error('save boom')),
    };
    const online = vi.fn().mockResolvedValue({
      ok: true as const,
      data: { word_id: 'word-1', created: true, duplicate_event: false },
    });
    const queue = new VocabularySaveQueue(online, 25, broken);
    expect(await queue.hydrate()).toHaveLength(0);
    const result = await queue.enqueueAndAttempt(makeRequest('evt-two-000000002'));
    await queue.flushPersistence();
    expect(result.status).toBe('saved');
    expect(queue.getEntries()).toHaveLength(1);
  });

  it('hydrate skips duplicates without overwriting newer in-memory attempts', async () => {
    const stale = makeEntry('evt-dup-000000001', 'pending', 0);
    const persistence: QueuePersistence = {
      load: vi.fn().mockResolvedValue([stale]),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    const queue = new VocabularySaveQueue(offline, 25, persistence);
    await queue.enqueueAndAttempt(makeRequest('evt-dup-000000001'));
    const restored = await queue.hydrate();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.attempts).toBe(1);
  });

  it('without persistence keeps the legacy in-memory behavior', async () => {
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    const queue = new VocabularySaveQueue(offline);
    expect(await queue.hydrate()).toHaveLength(0);
    await queue.enqueueAndAttempt(makeRequest('evt-three-0000003'));
    expect(queue.getEntries()).toHaveLength(1);
  });
});
