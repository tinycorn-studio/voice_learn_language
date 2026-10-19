import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ReviewRating,
  ReviewSubmitRequest,
  VoiceSessionState,
  VocabularyItem,
} from '@voice-chat/shared';
import { initTelegramEnvironment } from '../integrations/telegram/telegram-adapter.js';
import { AppIcon } from '../components/app-icon.js';
import { SavedWordToast } from './SavedWordToast.js';
import { FeedbackToast, type FeedbackToastTone } from './FeedbackToast.js';
import { LearningApiClient } from '../services/learning-api-client.js';
import {
  VoiceSessionPanel,
  type VoiceSessionFactory,
} from '../features/voice/components/VoiceSessionPanel.js';
import { createVoiceSession } from '../features/voice/services/voice-session.js';
import type { GeminiLiveClientCallbacks } from '../features/voice/services/gemini-live-client.js';
import { ApiDiagnosticsPanel } from './ApiDiagnosticsPanel.js';
import type { StartupDiagnostic } from '../services/startup-diagnostics.js';
import { InfoDialog } from './InfoDialog.js';
import { useAppTheme } from './hooks/use-app-theme.js';
import { useLearningData } from './hooks/use-learning-data.js';
import { useVocabularyCaptureQueue } from '../features/vocabulary/hooks/use-vocabulary-capture-queue.js';

type AppToastNotice =
  | { id: string; kind: 'saved'; word: string }
  | { id: string; kind: 'feedback'; message: string; tone: FeedbackToastTone };

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
  const [voiceState, setVoiceState] = useState<VoiceSessionState>('idle');
  const [infoOpen, setInfoOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginAttempt, setLoginAttempt] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toastNotices, setToastNotices] = useState<AppToastNotice[]>([]);
  const infoButtonRef = useRef<HTMLButtonElement | null>(null);
  const notifiedSavedEvents = useRef(new Set<string>());
  const deletes = useRef(new Map<string, string>());
  const reviews = useRef(new Map<string, ReviewSubmitRequest>());
  // Performance.now() is relative to this document's navigation start, even before React mounts.
  const startupStartedAt = useRef(0);
  const { colorScheme, themePreference, changeThemePreference } = useAppTheme();
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

  const closeInfo = useCallback(() => setInfoOpen(false), []);

  const {
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
  } = useLearningData({ api, authenticated, activeTab, recordStartup });
  const refreshVocabulary = useCallback(() => refresh('vocabulary'), [refresh]);
  const loadDueCardsForVoice = useCallback(async () => {
    const cards = await api.listDueReviews();
    setDueCards(cards);
    return cards;
  }, [api, setDueCards]);
  const {
    entries,
    queueCaptureError,
    retrying,
    saveVocabulary,
    retryQueueCaptureError,
    retryPending,
    handleCaptureFailure,
  } = useVocabularyCaptureQueue({
    api,
    vocabularyLoaded,
    refreshVocabulary,
    showToast,
  });
  const preview = useCallback((id: string) => api.previewReview(id), [api]);
  const translateText = useCallback((text: string) => api.translateText(text), [api]);

  useEffect(() => {
    recordStartup('app_mounted');
  }, [recordStartup]);

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
    };
  }, [api, loginAttempt, recordStartup]);

  useEffect(() => {
    if (authenticated) recordStartup('voice_ready');
  }, [authenticated, recordStartup]);

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
                onClick={() => void retryPending()}
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
          loadDueCards={loadDueCardsForVoice}
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
        <InfoDialog
          onClose={closeInfo}
          themePreference={themePreference}
          themeLabel={themeLabel}
          onUseAuto={() => changeThemePreference('auto')}
        />
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
