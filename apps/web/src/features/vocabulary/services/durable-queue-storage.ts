import { z } from 'zod';
import { vocabularyCreateRequestSchema } from '@voice-chat/shared';
import type { QueuedVocabularyEntry } from './vocabulary-save-queue.js';

/**
 * Durable persistence for the vocabulary capture queue (`M9-01`).
 * - Only pending/failed entries are stored; saved entries are transient UI state.
 * - Entries expire after a fixed TTL so user content does not stay in the browser forever.
 * - No auth material is stored: the request payload is the same shape sent to the API.
 */
export const QUEUE_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DB_NAME = 'voice-chat-capture-queue';
const STORE_NAME = 'entries';
const DB_VERSION = 1;

const persistedQueueRecordSchema = z.object({
  version: z.literal(1),
  updated_at_ms: z.number().int().nonnegative(),
  entry: z.object({
    request: vocabularyCreateRequestSchema,
    status: z.enum(['pending', 'failed']),
    attempts: z.number().int().nonnegative(),
    last_error: z.string().max(1000).nullable(),
    word_id: z.string().max(200).nullable(),
  }),
});

export interface QueuePersistence {
  load(): Promise<QueuedVocabularyEntry[]>;
  save(entries: QueuedVocabularyEntry[]): Promise<void>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Returns a persistence backed by IndexedDB, or `null` when IndexedDB is unavailable
 * (SSR, private mode restrictions). The queue then keeps its previous in-memory behavior.
 */
export function createIndexedDbQueuePersistence(options?: {
  dbName?: string;
  ttlMs?: number;
  now?: () => number;
}): QueuePersistence | null {
  if (typeof indexedDB === 'undefined') return null;
  const dbName = options?.dbName ?? DB_NAME;
  const ttlMs = options?.ttlMs ?? QUEUE_STORAGE_TTL_MS;
  const now = options?.now ?? Date.now;

  let dbPromise: Promise<IDBDatabase> | null = null;
  const openDb = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'entry.request.event_id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    return dbPromise;
  };

  return {
    async load(): Promise<QueuedVocabularyEntry[]> {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const raw = await requestToPromise(tx.objectStore(STORE_NAME).getAll());
      await transactionDone(tx);
      const nowMs = now();
      const restored: Array<{ entry: QueuedVocabularyEntry; updatedAtMs: number }> = [];
      for (const item of raw) {
        const parsed = persistedQueueRecordSchema.safeParse(item);
        if (!parsed.success) continue;
        if (nowMs - parsed.data.updated_at_ms > ttlMs) continue;
        restored.push({
          updatedAtMs: parsed.data.updated_at_ms,
          entry: {
            request: parsed.data.entry.request,
            status: parsed.data.entry.status,
            attempts: parsed.data.entry.attempts,
            lastError: parsed.data.entry.last_error,
            wordId: parsed.data.entry.word_id,
          },
        });
      }
      restored.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
      return restored.map((item) => item.entry);
    },

    async save(entries: QueuedVocabularyEntry[]): Promise<void> {
      const db = await openDb();
      const updatedAtMs = now();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      for (const entry of entries) {
        if (entry.status === 'saved') continue;
        store.put({
          version: 1,
          updated_at_ms: updatedAtMs,
          entry: {
            request: entry.request,
            status: entry.status,
            attempts: entry.attempts,
            last_error: entry.lastError,
            word_id: entry.wordId,
          },
        });
      }
      await transactionDone(tx);
    },
  };
}
