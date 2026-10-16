import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DueReviewCard,
  ReviewStatsResponse,
  VocabularyItem,
} from '@voice-chat/shared';
import type { LearningApiClient } from '../../services/learning-api-client.js';
import { CoalescedRefresh } from '../../services/coalesced-refresh.js';
import type { StartupDiagnostic } from '../../services/startup-diagnostics.js';

type LearningDataKey = 'vocabulary' | 'review';
type RefreshScope = LearningDataKey | 'all';

export function useLearningData({
  api,
  authenticated,
  activeTab,
  recordStartup,
}: {
  api: LearningApiClient;
  authenticated: boolean;
  activeTab: 'voice' | 'review' | 'vocabulary';
  recordStartup: (stage: StartupDiagnostic['stage'], stageStartedAt?: number) => void;
}) {
  const [words, setWords] = useState<VocabularyItem[]>([]);
  const [dueCards, setDueCards] = useState<DueReviewCard[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStatsResponse | null>(null);
  const [vocabularyLoading, setVocabularyLoading] = useState(false);
  const [vocabularyLoaded, setVocabularyLoaded] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [vocabularyError, setVocabularyError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const refreshVersion = useRef(0);

  const refresher = useMemo(
    () =>
      new CoalescedRefresh<LearningDataKey>(async (keys) => {
        const version = ++refreshVersion.current;
        const vocabularyStartedAt = keys.includes('vocabulary') ? performance.now() : null;
        const reviewStartedAt = keys.includes('review') ? performance.now() : null;
        if (vocabularyStartedAt !== null) recordStartup('vocabulary_load_started');
        if (reviewStartedAt !== null) recordStartup('review_load_started');
        const [vocabularyResult, reviewResult] = await Promise.all([
          keys.includes('vocabulary')
            ? api.listVocabulary().then(
                (value) => ({ ok: true as const, value }),
                (reason: unknown) => ({ ok: false as const, reason }),
              )
            : Promise.resolve(null),
          keys.includes('review')
            ? Promise.all([api.listDueReviews(), api.getReviewStats()]).then(
                (value) => ({ ok: true as const, value }),
                (reason: unknown) => ({ ok: false as const, reason }),
              )
            : Promise.resolve(null),
        ]);
        if (version !== refreshVersion.current) return;

        if (vocabularyResult) {
          if (vocabularyResult.ok) {
            setWords(vocabularyResult.value);
            setVocabularyLoaded(true);
            setVocabularyError(null);
            recordStartup('vocabulary_load_completed', vocabularyStartedAt ?? undefined);
          } else {
            recordStartup('vocabulary_load_failed', vocabularyStartedAt ?? undefined);
            setVocabularyError(
              vocabularyResult.reason instanceof Error
                ? vocabularyResult.reason.message
                : 'Không thể tải từ vựng.',
            );
          }
        }
        if (reviewResult) {
          if (reviewResult.ok) {
            setDueCards(reviewResult.value[0]);
            setReviewStats(reviewResult.value[1]);
            setReviewLoaded(true);
            setReviewError(null);
            recordStartup('review_load_completed', reviewStartedAt ?? undefined);
          } else {
            recordStartup('review_load_failed', reviewStartedAt ?? undefined);
            setReviewError(
              reviewResult.reason instanceof Error
                ? reviewResult.reason.message
                : 'Không thể tải thẻ ôn tập.',
            );
          }
        }
      }),
    [api, recordStartup],
  );

  const refresh = useCallback(
    (scope: RefreshScope = 'all') => {
      const keys: LearningDataKey[] =
        scope === 'all' ? ['vocabulary', 'review'] : [scope];
      if (keys.includes('vocabulary')) setVocabularyLoading(true);
      if (keys.includes('review')) setReviewLoading(true);
      return refresher.request(keys).finally(() => {
        if (keys.includes('vocabulary')) setVocabularyLoading(false);
        if (keys.includes('review')) setReviewLoading(false);
      });
    },
    [refresher],
  );

  useEffect(() => {
    if (!authenticated || activeTab !== 'review') return;
    void refresh('review');
    const timer = setInterval(() => void refresh('review'), 30000);
    return () => clearInterval(timer);
  }, [authenticated, activeTab, refresh]);

  useEffect(() => {
    if (!authenticated || activeTab !== 'vocabulary' || vocabularyLoaded) return;
    void refresh('vocabulary');
  }, [authenticated, activeTab, refresh, vocabularyLoaded]);

  useEffect(
    () => () => {
      refreshVersion.current++;
    },
    [],
  );

  return {
    words,
    setWords,
    dueCards,
    setDueCards,
    reviewStats,
    vocabularyLoading,
    vocabularyLoaded,
    reviewLoading,
    reviewLoaded,
    vocabularyError,
    reviewError,
    refresh,
  } as const;
}
