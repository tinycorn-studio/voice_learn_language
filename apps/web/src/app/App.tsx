import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DueReviewCard,
  ReviewRating,
  ReviewStatsResponse,
  ReviewSubmitRequest,
  VocabularyItem,
} from '@voice-chat/shared';
import { initTelegramEnvironment } from '../integrations/telegram/telegram-adapter.js';
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
import { FlashcardReviewPanel } from '../features/review/components/FlashcardReviewPanel.js';
import { VocabularyManagerPanel } from '../features/vocabulary/components/VocabularyManagerPanel.js';
import { ApiDiagnosticsPanel } from './ApiDiagnosticsPanel.js';
import { CoalescedRefresh } from '../services/coalesced-refresh.js';

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
        import.meta.env['VITE_API_BASE_URL'] ?? '',
        () => initTelegramEnvironment().rawInitData,
      ),
    [suppliedApi],
  );
  const [activeTab, setActiveTab] = useState<'voice' | 'review' | 'vocabulary'>('voice');
  const [words, setWords] = useState<VocabularyItem[]>([]);
  const [dueCards, setDueCards] = useState<DueReviewCard[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginAttempt, setLoginAttempt] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<QueuedVocabularyEntry[]>([]);
  const [retrying, setRetrying] = useState(false);
  const deletes = useRef(new Map<string, string>());
  const reviews = useRef(new Map<string, ReviewSubmitRequest>());
  const refreshVersion = useRef(0);

  const refresher = useMemo(
    () =>
      new CoalescedRefresh<'vocabulary' | 'review'>(async (keys) => {
        const version = ++refreshVersion.current;
        try {
          const [items, cards, stats] = await Promise.all([
            keys.includes('vocabulary') ? api.listVocabulary() : undefined,
            keys.includes('review') ? api.listDueReviews() : undefined,
            keys.includes('review') ? api.getReviewStats() : undefined,
          ]);
          if (version === refreshVersion.current) {
            if (items) setWords(items);
            if (cards) setDueCards(cards);
            if (stats) setReviewStats(stats);
            setError(null);
          }
        } catch (failure) {
          if (version === refreshVersion.current) {
            setError(failure instanceof Error ? failure.message : 'Không thể tải từ vựng.');
          }
        }
      }),
    [api],
  );
  const refresh = useCallback(
    (scope: 'vocabulary' | 'review' | 'all' = 'all') =>
      refresher.request(scope === 'all' ? ['vocabulary', 'review'] : [scope]),
    [refresher],
  );

  const preview = useCallback((id: string) => api.previewReview(id), [api]);

  useEffect(() => {
    if (!authenticated || activeTab !== 'review') return;
    void refresh('review');
    const timer = setInterval(() => {
      void refresh('review');
    }, 30000);
    return () => clearInterval(timer);
  }, [authenticated, activeTab, refresh]);

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
    void api
      .authenticate()
      .then(async () => {
        if (cancelled) return;
        setAuthenticated(true);
        await refresh('vocabulary');
      })
      .catch((failure) => {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : 'Đăng nhập thất bại.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      refreshVersion.current++;
    };
  }, [api, refresh, loginAttempt]);

  const saveVocabulary = useCallback(
    async (event: VerifiedSaveVocabularyEvent) => {
      try {
        const attempt = queue.enqueueAndAttempt(event);
        setEntries(queue.getEntries());
        const result = await attempt;
        setEntries(queue.getEntries());
        if (result.status === 'saved') void refresh('vocabulary');
        return { ok: result.status === 'saved' };
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Không thể xếp hàng lưu từ.');
        return { ok: false };
      }
    },
    [queue, refresh],
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
        Bấm Start để gửi giọng nói đến Gemini. Ứng dụng chỉ lưu từ và trích đoạn câu hỏi ngắn; không
        lưu toàn bộ audio. Dữ liệu gửi đến Gemini tuân theo chính sách của Google theo tier đang
        dùng.
      </div>
      {loading && <p role="status">Đang đăng nhập và tải từ vựng...</p>}
      {error && (
        <div role="alert" className="voice-error-banner">
          {error} {authenticated && <button onClick={() => void refresh()}>Tải lại dữ liệu</button>}
          {!authenticated && !loading && (
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                setLoginAttempt((attempt) => attempt + 1);
              }}
            >
              Thử kết nối lại
            </button>
          )}
        </div>
      )}
      <ApiDiagnosticsPanel api={api} />
      {!authenticated && !loading && (
        <p>Đóng cửa sổ này và mở lại qua nút Mini App của Telegram Bot để đăng nhập.</p>
      )}

      <nav className="app-tabs" aria-label="Main sections">
        {(
          [
            { tab: 'voice', label: 'Voice Tutor' },
            { tab: 'review', label: 'Flashcards SRS' },
            { tab: 'vocabulary', label: `Vocabulary (${words.length})` },
          ] as const
        ).map(({ tab, label }) => (
          <button
            key={tab}
            className={`btn-chip ${activeTab === tab ? 'active' : ''}`}
            data-testid={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>
      {entries.length > 0 && (
        <section aria-label="Vocabulary sync status" className="saved-badges-bar">
          {entries.map((entry) => (
            <div
              key={entry.request.event_id}
              data-testid="saved-word-badge"
              data-status={entry.status}
            >
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
                Thử đồng bộ lại
              </button>
            </>
          )}
        </section>
      )}
      {activeTab === 'voice' && (
        <VoiceSessionPanel sessionFactory={sessionFactory} enabled={authenticated && !loading} />
      )}
      {activeTab === 'review' && (
        <FlashcardReviewPanel
          items={dueCards}
          onGrade={grade}
          onPreview={preview}
          stats={reviewStats}
          enabled={authenticated && !loading}
        />
      )}
      {activeTab === 'vocabulary' && (
        <VocabularyManagerPanel
          items={words}
          onUpdateItem={update}
          onDeleteItem={remove}
          enabled={authenticated && !loading}
        />
      )}
    </main>
  );
}
