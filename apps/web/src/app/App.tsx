import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DueReviewCard,
  ReviewRating,
  ReviewStatsResponse,
  ReviewSubmitRequest,
  VocabularyItem,
} from '@voice-chat/shared';
import {
  initTelegramEnvironment,
  subscribeColorScheme,
} from '../integrations/telegram/telegram-adapter.js';
import { AppIcon } from '../components/app-icon.js';
import { ApiClientError, LearningApiClient } from '../services/learning-api-client.js';
import {
  VoiceSessionPanel,
  type VoiceSessionFactory,
} from '../features/voice/components/VoiceSessionPanel.js';
import { createVoiceSession } from '../features/voice/services/voice-session.js';
import type {
  GeminiLiveClientCallbacks,
  VerifiedSaveVocabularyEvent,
} from '../features/voice/services/gemini-live-client.js';
import {
  VocabularySaveQueue,
  type QueuedVocabularyEntry,
} from '../features/vocabulary/services/vocabulary-save-queue.js';
import { ApiDiagnosticsPanel } from './ApiDiagnosticsPanel.js';
import { CoalescedRefresh } from '../services/coalesced-refresh.js';
import type { StartupDiagnostic } from '../services/startup-diagnostics.js';

const FlashcardReviewPanel = lazy(() =>
  import('../features/review/components/FlashcardReviewPanel.js').then((module) => ({
    default: module.FlashcardReviewPanel,
  })),
);
const VocabularyManagerPanel = lazy(() =>
  import('../features/vocabulary/components/VocabularyManagerPanel.js').then((module) => ({
    default: module.VocabularyManagerPanel,
  })),
);

function PanelLoading({ label }: { label: string }) {
  return (
    <section className="voice-panel panel-loading" role="status" data-testid="panel-loading">
      <strong>{label}</strong>
      <span className="loading-bar" aria-hidden="true" />
      <span className="loading-bar loading-bar-short" aria-hidden="true" />
    </section>
  );
}

interface AppProps {
  api?: LearningApiClient;
  voiceFactory?: (
    mintToken: LearningApiClient['mintLiveToken'],
    callbacks: GeminiLiveClientCallbacks,
  ) => ReturnType<VoiceSessionFactory>;
}
export function App({ api: suppliedApi, voiceFactory = createVoiceSession }: AppProps) {
  const api = useMemo(
    () =>
      suppliedApi ??
      new LearningApiClient(
        import.meta.env.VITE_API_BASE_URL ?? '',
        () => initTelegramEnvironment().rawInitData,
      ),
    [suppliedApi],
  );
  const [activeTab, setActiveTab] = useState<'voice' | 'review' | 'vocabulary'>('voice');
  const [words, setWords] = useState<VocabularyItem[]>([]);
  const [dueCards, setDueCards] = useState<DueReviewCard[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStatsResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [vocabularyLoading, setVocabularyLoading] = useState(false);
  const [vocabularyLoaded, setVocabularyLoaded] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [loginAttempt, setLoginAttempt] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<QueuedVocabularyEntry[]>([]);
  const [retrying, setRetrying] = useState(false);
  const deletes = useRef(new Map<string, string>());
  const reviews = useRef(new Map<string, ReviewSubmitRequest>());
  const refreshVersion = useRef(0);
  const vocabularyLoadedRef = useRef(false);
  const reviewLoadedRef = useRef(false);
  // Performance.now() is relative to this document's navigation start, even before React mounts.
  const startupStartedAt = useRef(0);
  const recordStartup = useCallback(
    (stage: StartupDiagnostic['stage'], stageStartedAt?: number) => {
      const now = performance.now();
      api.diagnostics.recordStartup({
        stage,
        elapsed_ms: Math.max(0, now - startupStartedAt.current),
        ...(stageStartedAt !== undefined ? { duration_ms: Math.max(0, now - stageStartedAt) } : {}),
      });
    },
    [api],
  );

  useEffect(
    () =>
      subscribeColorScheme((scheme) => {
        document.documentElement.dataset.theme = scheme;
      }),
    [],
  );

  const refresher = useMemo(
    () =>
      new CoalescedRefresh<'vocabulary' | 'review'>(async (keys) => {
        const version = ++refreshVersion.current;
        const vocabularyStartedAt = keys.includes('vocabulary') ? performance.now() : null;
        const reviewStartedAt = keys.includes('review') ? performance.now() : null;
        if (vocabularyStartedAt !== null) recordStartup('vocabulary_load_started');
        if (reviewStartedAt !== null) recordStartup('review_load_started');
        try {
          const [items, cards, stats] = await Promise.all([
            keys.includes('vocabulary') ? api.listVocabulary() : undefined,
            keys.includes('review') ? api.listDueReviews() : undefined,
            keys.includes('review') ? api.getReviewStats() : undefined,
          ]);
          if (version === refreshVersion.current) {
            if (items) {
              vocabularyLoadedRef.current = true;
              setWords(items);
              setVocabularyLoaded(true);
              recordStartup('vocabulary_load_completed', vocabularyStartedAt ?? undefined);
            }
            if (cards && stats) {
              reviewLoadedRef.current = true;
              setDueCards(cards);
              setReviewStats(stats);
              setReviewLoaded(true);
              recordStartup('review_load_completed', reviewStartedAt ?? undefined);
            }
            setError(null);
          }
        } catch (failure) {
          if (version === refreshVersion.current) {
            if (vocabularyStartedAt !== null)
              recordStartup('vocabulary_load_failed', vocabularyStartedAt);
            if (reviewStartedAt !== null) recordStartup('review_load_failed', reviewStartedAt);
            setError(failure instanceof Error ? failure.message : 'Không thể tải từ vựng.');
          }
        }
      }),
    [api, recordStartup],
  );
  const refresh = useCallback(
    (scope: 'vocabulary' | 'review' | 'all' = 'all') => {
      const keys: Array<'vocabulary' | 'review'> =
        scope === 'all' ? ['vocabulary', 'review'] : [scope];
      if (keys.includes('vocabulary') && !vocabularyLoadedRef.current) setVocabularyLoading(true);
      if (keys.includes('review') && !reviewLoadedRef.current) setReviewLoading(true);
      return refresher.request(keys).finally(() => {
        if (keys.includes('vocabulary')) setVocabularyLoading(false);
        if (keys.includes('review')) setReviewLoading(false);
      });
    },
    [refresher],
  );

  const preview = useCallback((id: string) => api.previewReview(id), [api]);
  const translateText = useCallback((text: string) => api.translateText(text), [api]);

  useEffect(() => {
    if (!authenticated || activeTab !== 'review') return;
    void refresh('review');
    const timer = setInterval(() => {
      void refresh('review');
    }, 30000);
    return () => clearInterval(timer);
  }, [authenticated, activeTab, refresh]);

  useEffect(() => {
    if (!authenticated || activeTab !== 'vocabulary' || vocabularyLoaded) return;
    void refresh('vocabulary');
  }, [authenticated, activeTab, refresh, vocabularyLoaded]);

  useEffect(() => {
    recordStartup('app_mounted');
  }, [recordStartup]);

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

  useEffect(() => {
    let cancelled = false;
    const authStartedAt = performance.now();
    recordStartup('auth_started');
    void api
      .authenticate()
      .then(() => {
        if (cancelled) return;
        recordStartup('auth_ready', authStartedAt);
        setAuthenticated(true);
        setError(null);
      })
      .catch((failure) => {
        recordStartup('auth_failed', authStartedAt);
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : 'Đăng nhập thất bại.');
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
      refreshVersion.current++;
    };
  }, [api, loginAttempt, recordStartup]);

  useEffect(() => {
    if (authenticated) recordStartup('voice_ready');
  }, [authenticated, recordStartup]);

  const saveVocabulary = useCallback(
    async (event: VerifiedSaveVocabularyEvent) => {
      try {
        const attempt = queue.enqueueAndAttempt(event);
        setEntries(queue.getEntries());
        const result = await attempt;
        setEntries(queue.getEntries());
        if (result.status === 'saved' && vocabularyLoaded) void refresh('vocabulary');
        return { ok: result.status === 'saved' };
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Không thể xếp hàng lưu từ.');
        return { ok: false };
      }
    },
    [queue, refresh, vocabularyLoaded],
  );
  const sessionFactory = useCallback<VoiceSessionFactory>(
    (callbacks) =>
      voiceFactory(() => api.mintLiveToken(), {
        ...callbacks,
        onSaveVocabulary: saveVocabulary,
        onCaptureDiagnostic: (metadata) => api.diagnostics.recordCapture(metadata),
      }),
    [api, saveVocabulary, voiceFactory],
  );
  const grade = async (
    cardId: string,
    rating: ReviewRating,
    eventId: string,
    expectedVersion: number,
  ) => {
    // A lost acknowledgement must retry the identical version, even after a refresh.
    const input = reviews.current.get(eventId) ?? {
      event_id: eventId,
      card_id: cardId,
      rating,
      expected_version: expectedVersion,
    };
    reviews.current.set(eventId, input);
    const result = await api.submitReview(input);
    setDueCards((previous) => previous.filter((card) => card.card_id !== result.card_id));
    reviews.current.delete(eventId);
    void refresh('review');
  };
  const update = async (
    item: VocabularyItem,
    changes: { meaning_vi: string; example: string },
    eventId: string,
  ) => {
    const updated = await api.updateVocabulary(item.word_id, {
      ...changes,
      event_id: eventId,
      version: item.version,
    });
    setWords((previous) =>
      previous.map((word) => (word.word_id === updated.word_id ? updated : word)),
    );
  };
  const remove = async (wordId: string) => {
    const eventId = deletes.current.get(wordId) ?? crypto.randomUUID();
    deletes.current.set(wordId, eventId);
    await api.deleteVocabulary(wordId, eventId);
    setWords((previous) => previous.filter((item) => item.word_id !== wordId));
    deletes.current.delete(wordId);
  };
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">VoiceChat English Tutor</h1>
          <p className="app-subtitle">Luyện nói và ôn từ vựng cá nhân</p>
        </div>
      </header>
      <div className="privacy-notice" role="note">
        Bấm Start để gửi giọng nói đến Gemini. Bấm “Dịch” để gửi riêng câu đã chọn cho Gemini dịch.
        Ứng dụng không lưu toàn bộ audio, transcript hoặc bản dịch; dữ liệu gửi đến Gemini tuân theo
        chính sách của Google theo tier đang dùng.
      </div>
      {authLoading && (
        <div className="app-loading" role="status" data-testid="auth-loading">
          <span className="loading-dot" aria-hidden="true" />
          Đang xác thực Telegram...
        </div>
      )}
      {error && (
        <div role="alert" className="voice-error-banner">
          {error}{' '}
          {authenticated && (
            <button
              type="button"
              className="btn-secondary btn-outline-info"
              onClick={() => void refresh()}
            >
              <AppIcon name="again" size={18} /> Tải lại dữ liệu
            </button>
          )}
          {!authenticated && !authLoading && (
            <button
              type="button"
              className="btn-warning"
              onClick={() => {
                setAuthLoading(true);
                setError(null);
                setLoginAttempt((attempt) => attempt + 1);
              }}
            >
              <AppIcon name="again" size={18} /> Thử kết nối lại
            </button>
          )}
        </div>
      )}
      <ApiDiagnosticsPanel api={api} />
      {!authenticated && !authLoading && (
        <p>Đóng cửa sổ này và mở lại qua nút Mini App của Telegram Bot để đăng nhập.</p>
      )}

      {entries.length > 0 && (
        <section aria-label="Vocabulary sync status" className="saved-badges-bar">
          {entries.map((entry) => (
            <div
              key={entry.request.event_id}
              className="saved-word-badge"
              data-testid="saved-word-badge"
              data-status={entry.status}
            >
              <AppIcon
                name={
                  entry.status === 'saved'
                    ? 'good'
                    : entry.status === 'failed'
                      ? 'warning'
                      : 'clock'
                }
                size={18}
              />
              <strong>{entry.request.word}</strong>:{' '}
              {entry.status === 'saved'
                ? 'Đã lưu'
                : entry.status === 'failed'
                  ? 'Lưu thất bại'
                  : 'Chờ đồng bộ'}
              {entry.lastError && <span> — {entry.lastError}</span>}
            </div>
          ))}
          {entries.some((entry) => entry.status === 'pending') && (
            <>
              <p>Các từ đang chờ chỉ được giữ trong phiên này. Hãy thử lại trước khi đóng trang.</p>
              <button
                type="button"
                className="btn-warning"
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  void queue
                    .retryPending()
                    .then(async () => {
                      setEntries(queue.getEntries());
                      await refresh();
                    })
                    .finally(() => setRetrying(false));
                }}
              >
                <AppIcon name="again" size={18} /> Thử đồng bộ lại
              </button>
            </>
          )}
        </section>
      )}
      {activeTab === 'voice' && (
        <VoiceSessionPanel
          sessionFactory={sessionFactory}
          translateText={translateText}
          enabled={authenticated}
        />
      )}
      {activeTab === 'review' &&
        (!authenticated ? (
          <PanelLoading
            label={authLoading ? 'Đang xác thực Telegram...' : 'Cần đăng nhập để tải thẻ ôn.'}
          />
        ) : !reviewLoaded || reviewLoading ? (
          <PanelLoading label="Đang tải thẻ ôn tập..." />
        ) : (
          <Suspense fallback={<PanelLoading label="Đang mở Flashcards..." />}>
            <FlashcardReviewPanel
              items={dueCards}
              onGrade={grade}
              onPreview={preview}
              stats={reviewStats}
              enabled={authenticated}
            />
          </Suspense>
        ))}
      {activeTab === 'vocabulary' &&
        (!authenticated ? (
          <PanelLoading
            label={authLoading ? 'Đang xác thực Telegram...' : 'Cần đăng nhập để tải từ vựng.'}
          />
        ) : !vocabularyLoaded || vocabularyLoading ? (
          <PanelLoading label="Đang tải từ vựng..." />
        ) : (
          <Suspense fallback={<PanelLoading label="Đang mở sổ từ..." />}>
            <VocabularyManagerPanel
              items={words}
              onUpdateItem={update}
              onDeleteItem={remove}
              enabled={authenticated}
            />
          </Suspense>
        ))}
      <nav className="app-tabs" aria-label="Điều hướng chính">
        {(
          [
            { tab: 'voice', label: 'Voice Tutor', icon: 'voice' },
            { tab: 'review', label: 'Flashcards SRS', icon: 'review' },
            {
              tab: 'vocabulary',
              label: vocabularyLoaded ? `Vocabulary (${words.length})` : 'Vocabulary',
              icon: 'vocabulary',
            },
          ] as const
        ).map(({ tab, label, icon }) => (
          <button
            key={tab}
            type="button"
            className={`btn-chip ${activeTab === tab ? 'active' : ''}`}
            data-testid={`tab-${tab}`}
            aria-pressed={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          >
            <AppIcon name={icon} size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}
