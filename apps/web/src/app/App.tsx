import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  DueReviewCard,
  ReviewRating,
  ReviewStatsResponse,
  ReviewSubmitRequest,
  VoiceSessionState,
  VocabularyItem,
} from '@voice-chat/shared';
import {
  readThemePreference,
  initTelegramEnvironment,
  subscribeColorScheme,
  writeThemePreference,
  type ColorScheme,
  type ThemePreference,
} from '../integrations/telegram/telegram-adapter.js';
import { AppIcon } from '../components/app-icon.js';
import { SavedWordToast } from './SavedWordToast.js';
import { FeedbackToast, type FeedbackToastTone } from './FeedbackToast.js';
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

type AppToastNotice =
  | { id: string; kind: 'saved'; word: string }
  | { id: string; kind: 'feedback'; message: string; tone: FeedbackToastTone };

interface QueueCaptureError {
  event: VerifiedSaveVocabularyEvent;
  message: string;
}

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

function PanelError({
  message,
  retryLabel,
  busy,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="panel-load-error" role="alert">
      <p>{message}</p>
      <button
        type="button"
        className="btn-secondary btn-outline-info"
        disabled={busy}
        onClick={onRetry}
      >
        <AppIcon name={busy ? 'clock' : 'again'} size={18} />
        {busy ? 'Đang tải lại…' : retryLabel}
      </button>
    </div>
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
  const [environmentColorScheme, setEnvironmentColorScheme] = useState<ColorScheme>('light');
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(readThemePreference);
  const [voiceState, setVoiceState] = useState<VoiceSessionState>('idle');
  const [infoOpen, setInfoOpen] = useState(false);
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [vocabularyError, setVocabularyError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [queueCaptureError, setQueueCaptureError] = useState<QueueCaptureError | null>(null);
  const [entries, setEntries] = useState<QueuedVocabularyEntry[]>([]);
  const [toastNotices, setToastNotices] = useState<AppToastNotice[]>([]);
  const [retrying, setRetrying] = useState(false);
  const infoButtonRef = useRef<HTMLButtonElement | null>(null);
  const infoCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const infoDialogRef = useRef<HTMLDivElement | null>(null);
  const notifiedSavedEvents = useRef(new Set<string>());
  const queueCaptureErrorRef = useRef<QueueCaptureError | null>(null);
  const captureFailureToastTimes = useRef(new Map<string, number>());
  const deletes = useRef(new Map<string, string>());
  const reviews = useRef(new Map<string, ReviewSubmitRequest>());
  const refreshVersion = useRef(0);
  const vocabularyLoadedRef = useRef(false);
  const reviewLoadedRef = useRef(false);
  // Performance.now() is relative to this document's navigation start, even before React mounts.
  const startupStartedAt = useRef(0);
  const showToast = useCallback((message: string, tone: FeedbackToastTone) => {
    setToastNotices((previous) => {
      if (
        previous.some(
          (toast) => toast.kind === 'feedback' && toast.message === message && toast.tone === tone,
        )
      )
        return previous;
      return [
        ...previous,
        { id: `feedback-${crypto.randomUUID()}`, kind: 'feedback' as const, message, tone },
      ].slice(-3);
    });
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToastNotices((previous) => previous.filter((toast) => toast.id !== id));
  }, []);
  const updateQueueCaptureError = useCallback((notice: QueueCaptureError | null) => {
    queueCaptureErrorRef.current = notice;
    setQueueCaptureError(notice);
  }, []);
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

  const colorScheme = themePreference === 'auto' ? environmentColorScheme : themePreference;
  const changeThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreferenceState(preference);
    writeThemePreference(preference);
  }, []);

  useLayoutEffect(() => subscribeColorScheme(setEnvironmentColorScheme), []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', colorScheme === 'dark' ? '#0d1523' : '#f4f7fc');
  }, [colorScheme]);

  useEffect(() => {
    if (!infoOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    infoCloseButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setInfoOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        infoDialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [infoOpen]);

  const refresher = useMemo(
    () =>
      new CoalescedRefresh<'vocabulary' | 'review'>(async (keys) => {
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
            vocabularyLoadedRef.current = true;
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
            reviewLoadedRef.current = true;
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
    (scope: 'vocabulary' | 'review' | 'all' = 'all') => {
      const keys: Array<'vocabulary' | 'review'> =
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
        setAuthError(null);
      })
      .catch((failure) => {
        recordStartup('auth_failed', authStartedAt);
        if (!cancelled)
          setAuthError(failure instanceof Error ? failure.message : 'Đăng nhập thất bại.');
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
        updateQueueCaptureError({
          event,
          message: failure instanceof Error ? failure.message : 'Không thể xếp hàng lưu từ.',
        });
        return { ok: false };
      }
    },
    [queue, refresh, updateQueueCaptureError, vocabularyLoaded],
  );
  const retryQueueCaptureError = useCallback(async () => {
    const notice = queueCaptureErrorRef.current;
    if (!notice || retrying) return;
    setRetrying(true);
    try {
      const result = await queue.enqueueAndAttempt(notice.event);
      setEntries(queue.getEntries());
      updateQueueCaptureError(null);
      if (result.status === 'saved' && vocabularyLoaded) void refresh('vocabulary');
    } catch (failure) {
      updateQueueCaptureError({
        ...notice,
        message: failure instanceof Error ? failure.message : 'Không thể xếp hàng lưu từ.',
      });
    } finally {
      setRetrying(false);
    }
  }, [queue, refresh, retrying, updateQueueCaptureError, vocabularyLoaded]);
  useEffect(() => {
    const newlySaved = entries.filter(
      (entry) =>
        entry.status === 'saved' && !notifiedSavedEvents.current.has(entry.request.event_id),
    );
    if (newlySaved.length === 0) return;

    for (const entry of newlySaved) notifiedSavedEvents.current.add(entry.request.event_id);
    setToastNotices((previous) =>
      [
        ...previous,
        ...newlySaved.map((entry) => ({
          id: entry.request.event_id,
          kind: 'saved' as const,
          word: entry.request.word,
        })),
      ].slice(-3),
    );
  }, [entries]);
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
  const sessionFactory = useCallback<VoiceSessionFactory>(
    (callbacks) =>
      voiceFactory(() => api.mintLiveToken(), {
        ...callbacks,
        onSaveVocabulary: saveVocabulary,
        onVocabularyCaptureStatus: ({ word, status }) => {
          if (status === 'failed') handleCaptureFailure(word);
        },
        onCaptureDiagnostic: (metadata) => api.diagnostics.recordCapture(metadata),
      }),
    [api, handleCaptureFailure, saveVocabulary, voiceFactory],
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
  const unresolvedEntries = entries.filter((entry) => entry.status !== 'saved');
  const nextTheme = colorScheme === 'dark' ? 'light' : 'dark';
  const themeLabel = colorScheme === 'dark' ? 'Tối' : 'Sáng';
  const nextThemeLabel = nextTheme === 'dark' ? 'tối' : 'sáng';
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header-copy">
          <h1 className="app-title">VoiceChat English Tutor</h1>
          <p className="app-subtitle">Luyện nói và ôn từ vựng cá nhân</p>
        </div>
        <div className="app-header-actions" role="group" aria-label="Tùy chọn giao diện">
          <button
            type="button"
            className="theme-toggle"
            data-testid="theme-toggle"
            aria-label={`Chuyển sang giao diện ${nextThemeLabel}`}
            title={`Giao diện hiện tại: ${themeLabel}. Chuyển sang ${nextThemeLabel}`}
            onClick={() => changeThemePreference(nextTheme)}
          >
            <AppIcon name={colorScheme === 'dark' ? 'sun' : 'moon'} size={19} />
            <span>{themeLabel}</span>
          </button>
          <button
            ref={infoButtonRef}
            type="button"
            className="info-button"
            data-testid="info-button"
            aria-label="Hướng dẫn và quyền riêng tư"
            aria-haspopup="dialog"
            aria-expanded={infoOpen}
            onClick={() => {
              infoButtonRef.current?.focus();
              setInfoOpen(true);
            }}
          >
            <AppIcon name="info" size={21} />
          </button>
        </div>
      </header>
      {activeTab !== 'voice' && voiceState !== 'idle' && (
        <button
          type="button"
          className="voice-return-banner"
          data-testid="voice-return-banner"
          data-state={voiceState}
          onClick={() => setActiveTab('voice')}
        >
          <AppIcon name={voiceState === 'error' ? 'warning' : 'voice'} size={20} />
          <span>
            {voiceState === 'error'
              ? 'Phiên Voice gặp sự cố — quay lại để xem'
              : 'Phiên Voice vẫn đang chạy — quay lại hội thoại'}
          </span>
        </button>
      )}
      {authLoading && (
        <div className="app-loading" role="status" data-testid="auth-loading">
          <span className="loading-dot" aria-hidden="true" />
          Đang xác thực Telegram...
        </div>
      )}
      {authError && !authLoading && (
        <div role="alert" className="voice-error-banner">
          {authError}{' '}
          <button
            type="button"
            className="btn-warning"
            onClick={() => {
              setAuthLoading(true);
              setAuthError(null);
              setLoginAttempt((attempt) => attempt + 1);
            }}
          >
            <AppIcon name="again" size={18} /> Thử kết nối lại
          </button>
        </div>
      )}
      <ApiDiagnosticsPanel api={api} onToast={showToast} />
      {!authenticated && !authLoading && (
        <p>Đóng cửa sổ này và mở lại qua nút Mini App của Telegram Bot để đăng nhập.</p>
      )}

      {(unresolvedEntries.length > 0 || queueCaptureError !== null) && (
        <section aria-label="Vocabulary sync status" className="saved-badges-bar">
          {queueCaptureError && (
            <div className="queue-capture-error" role="alert" data-testid="queue-capture-error">
              <p>
                <strong>{queueCaptureError.event.word}</strong>: {queueCaptureError.message}
              </p>
              <button
                type="button"
                className="btn-warning"
                disabled={retrying}
                onClick={() => void retryQueueCaptureError()}
              >
                <AppIcon name="again" size={18} /> Thử xếp hàng lại
              </button>
            </div>
          )}
          {unresolvedEntries.map((entry) => (
            <div
              key={entry.request.event_id}
              className="saved-word-badge"
              data-testid="saved-word-badge"
              data-status={entry.status}
              role={entry.status === 'failed' ? 'alert' : 'status'}
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
          {unresolvedEntries.length > 0 && (
            <>
              <p>Các từ chưa lưu chỉ được giữ trong phiên này. Hãy thử lại trước khi đóng trang.</p>
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
                      await refresh('vocabulary');
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
      <div className="app-tab-panel" data-testid="voice-tab-panel" hidden={activeTab !== 'voice'}>
        <VoiceSessionPanel
          sessionFactory={sessionFactory}
          translateText={translateText}
          enabled={authenticated}
          onVoiceStateChange={setVoiceState}
          onToast={showToast}
        />
      </div>
      {activeTab === 'review' && !authenticated && (
        <PanelLoading
          label={authLoading ? 'Đang xác thực Telegram...' : 'Cần đăng nhập để tải thẻ ôn.'}
        />
      )}
      {activeTab === 'review' && authenticated && reviewError && (
        <PanelError
          message={`Không tải được thẻ ôn: ${reviewError}`}
          retryLabel="Tải lại thẻ ôn"
          busy={reviewLoading}
          onRetry={() => void refresh('review')}
        />
      )}
      {activeTab === 'review' && authenticated && !reviewLoaded && !reviewError && (
        <PanelLoading label="Đang tải thẻ ôn tập..." />
      )}
      {activeTab === 'review' && authenticated && reviewLoaded && (
        <Suspense fallback={<PanelLoading label="Đang mở Flashcards..." />}>
          <FlashcardReviewPanel
            items={dueCards}
            onGrade={grade}
            onPreview={preview}
            stats={reviewStats}
            enabled={authenticated}
          />
        </Suspense>
      )}
      {activeTab === 'vocabulary' && !authenticated && (
        <PanelLoading
          label={authLoading ? 'Đang xác thực Telegram...' : 'Cần đăng nhập để tải từ vựng.'}
        />
      )}
      {activeTab === 'vocabulary' && authenticated && vocabularyError && (
        <PanelError
          message={`Không tải được từ vựng: ${vocabularyError}`}
          retryLabel="Tải lại từ vựng"
          busy={vocabularyLoading}
          onRetry={() => void refresh('vocabulary')}
        />
      )}
      {activeTab === 'vocabulary' && authenticated && !vocabularyLoaded && !vocabularyError && (
        <PanelLoading label="Đang tải từ vựng..." />
      )}
      {activeTab === 'vocabulary' && authenticated && vocabularyLoaded && (
        <Suspense fallback={<PanelLoading label="Đang mở sổ từ..." />}>
          <VocabularyManagerPanel
            items={words}
            onUpdateItem={update}
            onDeleteItem={remove}
            enabled={authenticated}
          />
        </Suspense>
      )}
      {toastNotices.length > 0 && (
        <div className="saved-toast-stack" role="region" aria-label="Thông báo">
          {toastNotices.map((toast) =>
            toast.kind === 'saved' ? (
              <SavedWordToast
                key={toast.id}
                id={toast.id}
                word={toast.word}
                onDismiss={dismissToast}
              />
            ) : (
              <FeedbackToast
                key={toast.id}
                id={toast.id}
                message={toast.message}
                tone={toast.tone}
                onDismiss={dismissToast}
              />
            ),
          )}
        </div>
      )}
      {infoOpen && (
        <div
          className="info-modal-backdrop"
          data-testid="info-modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setInfoOpen(false);
          }}
        >
          <div
            ref={infoDialogRef}
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-modal-title"
            tabIndex={-1}
          >
            <div className="info-modal-header">
              <div>
                <p className="info-modal-eyebrow">VOICECHAT ENGLISH TUTOR</p>
                <h2 id="info-modal-title">Hướng dẫn & quyền riêng tư</h2>
              </div>
              <button
                ref={infoCloseButtonRef}
                type="button"
                className="info-modal-close"
                data-testid="info-close-button"
                aria-label="Đóng hướng dẫn"
                onClick={() => setInfoOpen(false)}
              >
                <AppIcon name="close" size={20} />
              </button>
            </div>
            <div className="info-modal-content">
              <section>
                <h3>Cách bắt đầu</h3>
                <p>
                  Bấm <strong>Start Microphone</strong> để bắt đầu hội thoại tiếng Anh với Gemini.
                  Chọn <strong>Dịch</strong> dưới từng câu nếu bạn muốn dịch riêng câu đó.
                </p>
              </section>
              <section>
                <h3>Quyền riêng tư</h3>
                <p>
                  Ứng dụng không lưu toàn bộ audio, transcript hoặc bản dịch. Nội dung được gửi đến
                  Gemini tuân theo chính sách của Google theo tier đang dùng.
                </p>
              </section>
              <section className="theme-preference-row" aria-label="Chế độ giao diện">
                <span>
                  Giao diện: <strong>{themePreference === 'auto' ? 'Tự động' : themeLabel}</strong>
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-outline-info"
                  data-testid="theme-auto-button"
                  disabled={themePreference === 'auto'}
                  onClick={() => changeThemePreference('auto')}
                >
                  Dùng theme Telegram/thiết bị
                </button>
              </section>
            </div>
          </div>
        </div>
      )}
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
