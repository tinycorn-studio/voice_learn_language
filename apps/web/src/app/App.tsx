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
        import.meta.env['VITE_API_BASE_URL'] ||
          'https://voice-chat-learn-language-worker.voice-chat-learn-language.workers.dev',
        () => initTelegramEnvironment().rawInitData,
      ),
    [suppliedApi],
  );
  const [activeTab, setActiveTab] = useState<'voice' | 'review' | 'vocabulary'>('voice');
  const [words, setWords] = useState<VocabularyItem[]>([]);
  const [dueCards, setDueCards] = useState<DueReviewCard[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<QueuedVocabularyEntry[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>>([]);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const deletes = useRef(new Map<string, string>());
  const reviews = useRef(new Map<string, ReviewSubmitRequest>());
  const refreshVersion = useRef(0);

  const addLog = useCallback(
    (level: 'info' | 'warn' | 'error', message: string, details?: unknown) => {
      const now = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date());
      setLogs((prev) => [{ id: crypto.randomUUID(), timestamp: now, level, message }, ...prev.slice(0, 49)]);
      void api.postClientLog({ level, message, details });
    },
    [api],
  );

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const [items, cards, stats] = await Promise.all([
        api.listVocabulary(),
        api.listDueReviews(),
        api.getReviewStats(),
      ]);
      if (version === refreshVersion.current) {
        setWords(items);
        setDueCards(cards);
        setReviewStats(stats);
        setError(null);
      }
    } catch (failure) {
      if (version === refreshVersion.current) {
        const msg = failure instanceof Error ? failure.message : 'Không thể tải từ vựng.';
        setError(msg);
        addLog('error', `Lỗi tải dữ liệu: ${msg}`);
      }
    }
  }, [api, addLog]);

  const handlePing = useCallback(async () => {
    setPingResult('Đang kiểm tra kết nối...');
    addLog('info', 'Bắt đầu ping máy chủ...');
    const res = await api.pingHealth();
    if (res.ok) {
      const msg = `✅ Máy chủ online! Độ trễ: ${res.latencyMs}ms (HTTP ${res.status})`;
      setPingResult(msg);
      addLog('info', msg);
    } else {
      const msg = `❌ Kết nối thất bại: ${res.error || `HTTP ${res.status}`} (${res.latencyMs}ms)`;
      setPingResult(msg);
      addLog('error', msg);
    }
  }, [api, addLog]);

  const handleCopyLogs = useCallback(() => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [logs]);

  const preview = useCallback((id: string) => api.previewReview(id), [api]);

  useEffect(() => {
    if (!authenticated || activeTab !== 'review') return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
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

  const authAttempt = useCallback(async () => {
    setLoading(true);
    setError(null);
    const env = initTelegramEnvironment();
    addLog('info', `Init WebApp: isMiniApp=${env.isTelegramMiniApp}, initDataLen=${env.rawInitData.length}, platform=${env.platform}`);
    addLog('info', `Target Worker: ${api.getBaseUrl()}`);
    if (!env.rawInitData) {
      addLog('warn', 'Telegram initData trống. Hãy đảm bảo mở ứng dụng từ Bot Telegram.');
    }
    try {
      addLog('info', 'Đang gửi xác thực đến Worker...');
      const session = await api.authenticate();
      setAuthenticated(true);
      addLog('info', `Đăng nhập thành công! User ID: ${session.user_id}`);
      await refresh();
      addLog('info', 'Đã tải thành công danh sách từ vựng & flashcards.');
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : 'Đăng nhập thất bại.';
      setError(msg);
      addLog('error', `Lỗi xác thực: ${msg}`);
      setShowLogs(true);
    } finally {
      setLoading(false);
    }
  }, [api, addLog, refresh]);

  useEffect(() => {
    void authAttempt();
  }, [authAttempt]);

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
        <p>Nếu gặp lỗi, hãy bấm <strong>Kiểm tra máy chủ (Ping)</strong> hoặc <strong>Thử kết nối lại</strong> bên dưới.</p>
      )}

      <section className="diag-panel" aria-label="System diagnostics">
        <div className="diag-header">
          <span>🛠️ Nhật ký & Kiểm tra kết nối</span>
          <button
            type="button"
            className="btn-chip"
            onClick={() => setShowLogs((s) => !s)}
          >
            {showLogs ? 'Thu gọn' : 'Xem chi tiết'}
          </button>
        </div>
        {pingResult && <div className="diag-ping-badge">{pingResult}</div>}
        <div className="diag-actions">
          <button type="button" className="btn-chip" onClick={() => void handlePing()}>
            🔍 Kiểm tra máy chủ (Ping)
          </button>
          <button type="button" className="btn-chip" onClick={() => void authAttempt()}>
            🔄 Thử kết nối lại
          </button>
          <button type="button" className="btn-chip" onClick={handleCopyLogs}>
            {copied ? '✅ Đã sao chép' : '📋 Sao chép log'}
          </button>
        </div>
        {showLogs && (
          <div className="diag-console" role="log" aria-live="polite">
            {logs.length === 0 ? (
              <span className="diag-log-info">Chưa có log sự kiện.</span>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={`diag-log-row diag-log-${log.level}`}>
                  [{log.timestamp}] [{log.level.toUpperCase()}] {log.message}
                </div>
              ))
            )}
          </div>
        )}
      </section>

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
