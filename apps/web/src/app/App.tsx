import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewRating, ReviewSubmitRequest, VocabularyItem } from '@voice-chat/shared';
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
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<QueuedVocabularyEntry[]>([]);
  const [retrying, setRetrying] = useState(false);
  const deletes = useRef(new Map<string, string>());
  const reviews = useRef(new Map<string, ReviewSubmitRequest>());
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const items = await api.listVocabulary();
      if (version === refreshVersion.current) {
        setWords(items);
        setError(null);
      }
    } catch (failure) {
      if (version === refreshVersion.current)
        setError(failure instanceof Error ? failure.message : 'Không thể tải từ vựng.');
    }
  }, [api]);
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
        await refresh();
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
  }, [api, refresh]);

  const saveVocabulary = useCallback(
    async (event: VerifiedSaveVocabularyEvent) => {
      try {
        const attempt = queue.enqueueAndAttempt(event);
        setEntries(queue.getEntries());
        const result = await attempt;
        setEntries(queue.getEntries());
        if (result.status === 'saved') await refresh();
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
      voiceFactory(() => api.mintLiveToken(), { ...callbacks, onSaveVocabulary: saveVocabulary }),
    [api, saveVocabulary, voiceFactory],
  );
  const grade = async (wordId: string, rating: ReviewRating, eventId: string) => {
    const card = words.find((word) => word.word_id === wordId);
    // A lost acknowledgement must retry the identical version, even after a refresh.
    const input = reviews.current.get(eventId) ?? {
      event_id: eventId,
      word_id: wordId,
      rating,
      ...(card ? { version: card.version } : {}),
    };
    reviews.current.set(eventId, input);
    const result = await api.submitReview(input);
    setWords((previous) =>
      previous.map((word) =>
        word.word_id === wordId
          ? {
              ...word,
              due_at: result.next_due_at,
              interval_days: result.interval_days,
              repetitions: result.repetitions,
              ease_factor: result.ease_factor,
              review_state: result.review_state,
              version: Math.max(word.version, (input.version ?? word.version) + 1),
            }
          : word,
      ),
    );
    reviews.current.delete(eventId);
    await refresh();
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
        </div>
      )}
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
        <FlashcardReviewPanel items={words} onGrade={grade} enabled={authenticated && !loading} />
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
