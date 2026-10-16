import { useCallback, useMemo, useRef, useState } from 'react';
import type { LearningApiClient } from '../../../services/learning-api-client.js';
import { ApiClientError } from '../../../services/learning-api-client.js';
import type { FeedbackToastTone } from '../../../app/FeedbackToast.js';
import type { VerifiedSaveVocabularyEvent } from '../../voice/services/gemini-live-client.js';
import {
  VocabularySaveQueue,
  type QueuedVocabularyEntry,
} from '../services/vocabulary-save-queue.js';

interface QueueCaptureError {
  event: VerifiedSaveVocabularyEvent;
  message: string;
}

export function useVocabularyCaptureQueue({
  api,
  vocabularyLoaded,
  refreshVocabulary,
  showToast,
}: {
  api: LearningApiClient;
  vocabularyLoaded: boolean;
  refreshVocabulary: () => Promise<void>;
  showToast: (message: string, tone: FeedbackToastTone) => void;
}) {
  const [entries, setEntries] = useState<QueuedVocabularyEntry[]>([]);
  const [queueCaptureError, setQueueCaptureError] = useState<QueueCaptureError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const queueCaptureErrorRef = useRef<QueueCaptureError | null>(null);
  const captureFailureToastTimes = useRef(new Map<string, number>());
  const queue = useMemo(
    () =>
      new VocabularySaveQueue(async (input) => {
        try {
          return { ok: true, data: await api.createVocabulary(input) };
        } catch (failure) {
          return {
            ok: false,
            errorMessage: failure instanceof Error ? failure.message : 'Không thể lưu từ.',
            retryable: failure instanceof ApiClientError && failure.retryable,
          };
        }
      }),
    [api],
  );

  const updateQueueCaptureError = useCallback((notice: QueueCaptureError | null) => {
    queueCaptureErrorRef.current = notice;
    setQueueCaptureError(notice);
  }, []);

  const saveVocabulary = useCallback(
    async (event: VerifiedSaveVocabularyEvent) => {
      try {
        const attempt = queue.enqueueAndAttempt(event);
        setEntries(queue.getEntries());
        const result = await attempt;
        setEntries(queue.getEntries());
        if (result.status === 'saved' && vocabularyLoaded) void refreshVocabulary();
        return { ok: result.status === 'saved' };
      } catch (failure) {
        updateQueueCaptureError({
          event,
          message: failure instanceof Error ? failure.message : 'Không thể xếp hàng lưu từ.',
        });
        return { ok: false };
      }
    },
    [queue, refreshVocabulary, updateQueueCaptureError, vocabularyLoaded],
  );

  const retryQueueCaptureError = useCallback(async () => {
    const notice = queueCaptureErrorRef.current;
    if (!notice || retrying) return;
    setRetrying(true);
    try {
      const result = await queue.enqueueAndAttempt(notice.event);
      setEntries(queue.getEntries());
      updateQueueCaptureError(null);
      if (result.status === 'saved' && vocabularyLoaded) void refreshVocabulary();
    } catch (failure) {
      updateQueueCaptureError({
        ...notice,
        message: failure instanceof Error ? failure.message : 'Không thể xếp hàng lưu từ.',
      });
    } finally {
      setRetrying(false);
    }
  }, [queue, refreshVocabulary, retrying, updateQueueCaptureError, vocabularyLoaded]);

  const retryPending = useCallback(async () => {
    setRetrying(true);
    try {
      await queue.retryPending();
      setEntries(queue.getEntries());
      await refreshVocabulary();
    } finally {
      setRetrying(false);
    }
  }, [queue, refreshVocabulary]);

  const handleCaptureFailure = useCallback(
    (word: string) => {
      const normalizedWord = word.trim().toLowerCase();
      const hasQueueEntry = queue
        .getEntries()
        .some(
          (entry) =>
            entry.status !== 'saved' && entry.request.word.trim().toLowerCase() === normalizedWord,
        );
      const queueFailure = queueCaptureErrorRef.current?.event.word.trim().toLowerCase();
      if (hasQueueEntry || queueFailure === normalizedWord) return;

      const now = Date.now();
      const lastToastAt = captureFailureToastTimes.current.get(normalizedWord) ?? 0;
      if (now - lastToastAt < 6000) return;
      captureFailureToastTimes.current.set(normalizedWord, now);
      for (const [key, shownAt] of captureFailureToastTimes.current) {
        if (now - shownAt >= 6000) captureFailureToastTimes.current.delete(key);
      }
      showToast(`Chưa xác nhận lưu từ “${word}”. Hãy hỏi lại tên từ cụ thể.`, 'warning');
    },
    [queue, showToast],
  );

  return {
    entries,
    queueCaptureError,
    retrying,
    saveVocabulary,
    retryQueueCaptureError,
    retryPending,
    handleCaptureFailure,
  } as const;
}
