import type { VocabularyCreateRequest, VocabularyCreateResponse } from '@voice-chat/shared';

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
) => Promise<{ ok: true; data: VocabularyCreateResponse } | { ok: false; errorMessage: string }>;

/**
 * Bounded session retry queue for vocabulary persistence (`docs/01_ARCHITECTURE.md`, `M3-04`, `TC-14`).
 * - Never reports `saved` prematurely when GAS/Worker is offline or times out (`TC-14`).
 * - Reuses the exact same `event_id` across retries so `Words`/`Events` remain idempotent (`TC-05`).
 */
export class VocabularySaveQueue {
  private readonly entries = new Map<string, QueuedVocabularyEntry>();

  public constructor(
    private readonly persistFn: PersistVocabularyFn,
    private readonly maxEntries = 25,
  ) {}

  public getEntries(): QueuedVocabularyEntry[] {
    return Array.from(this.entries.values());
  }

  public async enqueueAndAttempt(
    request: VocabularyCreateRequest,
  ): Promise<QueuedVocabularyEntry> {
    const existing = this.entries.get(request.event_id);
    if (existing && existing.status === 'saved') {
      return existing;
    }

    if (!existing && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
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

    try {
      const result = await this.persistFn(request);
      if (result.ok) {
        entry.status = 'saved';
        entry.wordId = result.data.word_id;
        entry.lastError = null;
      } else {
        entry.status = 'pending';
        entry.lastError = result.errorMessage;
      }
    } catch (err) {
      entry.status = 'pending';
      entry.lastError = err instanceof Error ? err.message : 'Network error';
    }

    return { ...entry };
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
