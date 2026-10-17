import type { VocabularyCreateRequest, VocabularyCreateResponse } from '@voice-chat/shared';
import type { QueuePersistence } from './durable-queue-storage.js';

export type QueueItemStatus = 'pending' | 'saved' | 'failed';

export interface QueuedVocabularyEntry {
  request: VocabularyCreateRequest;
  status: QueueItemStatus;
  attempts: number;
  lastError: string | null;
  wordId: string | null;
}

export type PersistVocabularyFn = (
  req: VocabularyCreateRequest,
) => Promise<
  | { ok: true; data: VocabularyCreateResponse }
  | { ok: false; errorMessage: string; retryable?: boolean }
>;

/**
 * Bounded retry queue for vocabulary persistence (`docs/01_ARCHITECTURE.md`, `M3-04`, `TC-14`, `M9-01`).
 * - Never reports `saved` prematurely when GAS/Worker is offline or times out (`TC-14`).
 * - Reuses the exact same `event_id` across retries so `Words`/`Events` remain idempotent (`TC-05`).
 * - Optional persistence keeps pending/failed entries across reloads (`M9-01`); storage
 *   failures are swallowed so the queue never loses its in-memory behavior.
 */
export class VocabularySaveQueue {
  private readonly entries = new Map<string, QueuedVocabularyEntry>();
  private readonly pending = new Map<string, Promise<QueuedVocabularyEntry>>();
  private persistChain: Promise<void> = Promise.resolve();

  public constructor(
    private readonly persistFn: PersistVocabularyFn,
    private readonly maxEntries = 25,
    private readonly persistence: QueuePersistence | null = null,
  ) {}

  public getEntries(): QueuedVocabularyEntry[] {
    return Array.from(this.entries.values(), (entry) => ({ ...entry }));
  }

  /**
   * Restores entries persisted by a previous session. Never throws: an unavailable or
   * corrupt store leaves the queue empty so callers behave like the in-memory queue.
   */
  public async hydrate(): Promise<QueuedVocabularyEntry[]> {
    if (!this.persistence) return this.getEntries();
    try {
      const restored = await this.persistence.load();
      for (const entry of restored) {
        if (this.entries.has(entry.request.event_id)) continue;
        if (this.entries.size >= this.maxEntries) break;
        this.entries.set(entry.request.event_id, entry);
      }
    } catch {
      // Storage is best-effort; the queue continues working in memory.
    }
    return this.getEntries();
  }

  private schedulePersist(): void {
    if (!this.persistence) return;
    const snapshot = this.getEntries().filter((entry) => entry.status !== 'saved');
    this.persistChain = this.persistChain
      .then(() => this.persistence?.save(snapshot))
      .then(
        () => undefined,
        () => undefined,
      );
  }

  /** Resolves after every scheduled persistence write settled (best-effort). */
  public async flushPersistence(): Promise<void> {
    await this.persistChain;
  }

  public async enqueueAndAttempt(request: VocabularyCreateRequest): Promise<QueuedVocabularyEntry> {
    const existing = this.entries.get(request.event_id);
    const pending = this.pending.get(request.event_id);
    if (pending) return pending;
    if (existing && existing.status === 'saved') {
      return existing;
    }

    if (!existing && this.entries.size >= this.maxEntries) {
      const savedEntry = [...this.entries].find(([, entry]) => entry.status === 'saved');
      if (savedEntry) this.entries.delete(savedEntry[0]);
      else throw new Error('Hàng đợi lưu từ đã đầy. Hãy xử lý các từ đang chờ trước khi tiếp tục.');
    }

    const entry: QueuedVocabularyEntry = existing ?? {
      request,
      status: 'pending',
      attempts: 0,
      lastError: null,
      wordId: null,
    };
    entry.status = 'pending';
    entry.attempts += 1;
    this.entries.set(request.event_id, entry);
    this.schedulePersist();
    const work = (async () => {
      try {
        const result = await this.persistFn(request);
        if (result.ok) {
          entry.status = 'saved';
          entry.wordId = result.data.word_id;
          entry.lastError = null;
        } else {
          entry.status = result.retryable === false || entry.attempts >= 3 ? 'failed' : 'pending';
          entry.lastError = result.errorMessage;
        }
      } catch (err) {
        entry.status = entry.attempts >= 3 ? 'failed' : 'pending';
        entry.lastError = err instanceof Error ? err.message : 'Network error';
      }
      this.schedulePersist();

      return { ...entry };
    })();
    this.pending.set(request.event_id, work);
    try {
      return await work;
    } finally {
      this.pending.delete(request.event_id);
    }
  }

  public async retryPending(): Promise<QueuedVocabularyEntry[]> {
    const updated: QueuedVocabularyEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== 'saved') {
        const res = await this.enqueueAndAttempt(entry.request);
        updated.push(res);
      }
    }
    return updated;
  }
}
