import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationContextTurn, DueReviewCard, VoiceSessionState } from '@voice-chat/shared';
import { normalizeVocabularyQuestion } from '@voice-chat/shared';
import { AppIcon } from '../../../components/app-icon.js';
import type {
  GeminiLiveClientCallbacks,
  TutorRoleplayScenario,
  TutorSessionContext,
} from '../services/gemini-live-client.js';
import type { CoachCorrection } from '../services/coaching.js';
import { buildSessionInsights, type SessionInsights } from '../services/session-insights.js';
import type { VoiceSession } from '../services/voice-session.js';
import { VoiceStatusBadge } from './VoiceStatusBadge.js';

export type VoiceSessionFactory = (
  callbacks: Omit<GeminiLiveClientCallbacks, 'onSaveVocabulary'>,
) => VoiceSession;
export interface VoiceSessionPanelProps {
  sessionFactory: VoiceSessionFactory;
  translateText: (text: string) => Promise<string>;
  loadDueCards?: () => Promise<DueReviewCard[]>;
  enabled?: boolean;
  onVoiceStateChange?: (state: VoiceSessionState) => void;
  onToast?: (message: string, tone: 'success' | 'info' | 'warning') => void;
}

interface TranscriptTurn extends ConversationContextTurn {
  id: string;
}

interface TurnTranslation {
  status: 'loading' | 'ready' | 'failed';
  text?: string;
  error?: string;
  visible?: boolean;
}

interface DisplayCoachCorrection extends CoachCorrection {
  id: string;
  turnId: string;
}

const ROLEPLAY_OPTIONS: ReadonlyArray<{ id: TutorRoleplayScenario; label: string }> = [
  { id: 'free_talk', label: 'Hội thoại tự do' },
  { id: 'job_interview', label: 'Phỏng vấn xin việc' },
  { id: 'hotel_complaint', label: 'Phản ánh dịch vụ khách sạn' },
  { id: 'market_bargaining', label: 'Trả giá khi mua đồ' },
  { id: 'short_presentation', label: 'Thuyết trình ngắn' },
];

function dueCardKey(card: DueReviewCard): string {
  return card.card_id ?? card.review_id;
}

function highlightPhrase(sentence: string, phrase: string) {
  const index = sentence.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  if (index < 0) return sentence;
  return (
    <>
      {sentence.slice(0, index)}
      <mark>{sentence.slice(index, index + phrase.length)}</mark>
      {sentence.slice(index + phrase.length)}
    </>
  );
}

function formatSpeechDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes} phút ${remainingSeconds} giây` : `${remainingSeconds} giây`;
}

interface TranscriptTurnRowProps {
  turn: TranscriptTurn;
  translation: TurnTranslation | undefined;
  enabled: boolean;
  onTranslate: (turn: TranscriptTurn) => void;
  correction: DisplayCoachCorrection | undefined;
  shadowing: boolean;
  onShadow: (id: string) => void;
}

const TranscriptTurnRow = memo(function TranscriptTurnRow({
  turn,
  translation,
  enabled,
  onTranslate,
  correction,
  shadowing,
  onShadow,
}: TranscriptTurnRowProps) {
  return (
    <div className={`transcript-turn turn-${turn.speaker}`}>
      <div className="transcript-turn-content">
        <p>
          <strong className="turn-speaker">{turn.speaker === 'user' ? 'Bạn' : 'Gia sư AI'}:</strong>{' '}
          {turn.text}
        </p>
        <button
          type="button"
          className="transcript-translate-button"
          data-testid={`btn-translate-${turn.id}`}
          aria-expanded={translation?.status === 'ready' && translation.visible === true}
          aria-controls={
            translation?.status === 'ready' && translation.visible
              ? `translation-${turn.id}`
              : undefined
          }
          disabled={!enabled || translation?.status === 'loading'}
          onClick={() => onTranslate(turn)}
        >
          <AppIcon name={translation?.status === 'failed' ? 'again' : 'translate'} size={18} />
          {translation?.status === 'loading'
            ? 'Đang dịch…'
            : translation?.status === 'failed'
              ? 'Thử lại'
              : translation?.status === 'ready'
                ? translation.visible
                  ? 'Ẩn bản dịch'
                  : 'Hiện bản dịch'
                : 'Dịch'}
        </button>
      </div>
      {translation?.status === 'ready' && translation.visible && (
        <p
          id={`translation-${turn.id}`}
          className="transcript-translation"
          data-testid={`translation-${turn.id}`}
        >
          <strong>Bản dịch:</strong> {translation.text}
        </p>
      )}
      {translation?.status === 'failed' && (
        <p className="transcript-translation-error" role="status">
          {translation.error}
        </p>
      )}
      {correction && (
        <aside className="coach-correction-card" data-testid={`coach-correction-${turn.id}`}>
          <p>
            <strong>
              {correction.category === 'pronunciation' ? 'Gợi ý phát âm:' : 'Câu gợi ý:'}
            </strong>{' '}
            {highlightPhrase(correction.suggested_sentence, correction.focus_phrase)}
          </p>
          {correction.pronunciation_tip && (
            <p className="coach-pronunciation-tip">{correction.pronunciation_tip}</p>
          )}
          <button
            type="button"
            className="btn-success btn-outline-success"
            data-testid={`btn-shadow-${turn.id}`}
            aria-pressed={shadowing}
            onClick={() => onShadow(correction.id)}
          >
            <AppIcon name="speaker" size={18} />
            {shadowing ? 'Đang luyện câu này' : 'Nhại lại câu này'}
          </button>
          {shadowing && (
            <p className="shadowing-status" role="status">
              Hãy đọc câu gợi ý qua micro; lượt nói tiếp theo sẽ kết thúc bước luyện này.
            </p>
          )}
        </aside>
      )}
    </div>
  );
});

function SessionInsightsCard({ report }: { report: SessionInsights }) {
  const diversity =
    report.vocabularyDiversity === null ? null : Math.round(report.vocabularyDiversity * 100);
  const correctionTotal = Object.values(report.correctionsByCategory).reduce(
    (total, count) => total + count,
    0,
  );
  return (
    <section className="session-insights-card" data-testid="session-insights" aria-live="polite">
      <div className="session-insights-heading">
        <AppIcon name="spark" size={22} />
        <div>
          <h3>Tổng kết buổi nói</h3>
          <p>Chỉ tổng hợp trên thiết bị từ phiên vừa kết thúc.</p>
        </div>
      </div>
      <div className="session-insights-grid">
        <div>
          <span>Thời lượng nói ước tính</span>
          <strong>
            {report.estimatedSpeechSeconds === null
              ? 'Chưa ghi nhận giọng nói rõ'
              : formatSpeechDuration(report.estimatedSpeechSeconds)}
          </strong>
        </div>
        <div>
          <span>Từ tiếng Anh khác nhau</span>
          <strong>
            {diversity === null
              ? 'Chưa có từ tiếng Anh'
              : `${report.uniqueLearnerWords}/${report.totalLearnerWords} · ${diversity}%`}
          </strong>
        </div>
        <div>
          <span>Gợi ý coaching</span>
          <strong>{correctionTotal}</strong>
        </div>
      </div>
      {correctionTotal > 0 && (
        <p className="session-insights-categories">
          {report.correctionsByCategory.grammar > 0 &&
            `Ngữ pháp ${report.correctionsByCategory.grammar}`}
          {report.correctionsByCategory.word_choice > 0 &&
            `${report.correctionsByCategory.grammar > 0 ? ' · ' : ''}Dùng từ ${report.correctionsByCategory.word_choice}`}
          {report.correctionsByCategory.pronunciation > 0 &&
            `${report.correctionsByCategory.grammar + report.correctionsByCategory.word_choice > 0 ? ' · ' : ''}Phát âm ${report.correctionsByCategory.pronunciation}`}
        </p>
      )}
      <div className="session-insight-phrases">
        <strong>Cụm có thể dùng lại</strong>
        {report.suggestedPhrases.length > 0 ? (
          <ul>
            {report.suggestedPhrases.map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ul>
        ) : (
          <p>Chưa có câu gợi ý trong phiên này.</p>
        )}
      </div>
      <p className="session-insights-note">
        Thời lượng được ước tính từ mức âm thanh micro; độ đa dạng từ chỉ là thống kê transcript,
        không phải điểm fluency.
      </p>
    </section>
  );
}

export function VoiceSessionPanel({
  sessionFactory,
  translateText,
  loadDueCards,
  enabled = true,
  onVoiceStateChange,
  onToast,
}: VoiceSessionPanelProps) {
  const session = useRef<VoiceSession | null>(null);
  const transcriptBox = useRef<HTMLDivElement | null>(null);
  const followTranscript = useRef(true);
  const nextTurnId = useRef(0);
  const [state, setState] = useState<VoiceSessionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [translations, setTranslations] = useState<Record<string, TurnTranslation>>({});
  const [followingTranscript, setFollowingTranscript] = useState(true);
  const [interim, setInterim] = useState('');
  const [text, setText] = useState('');
  const [scenario, setScenario] = useState<TutorRoleplayScenario>('free_talk');
  const [coachingEnabled, setCoachingEnabled] = useState(true);
  const [duePanelOpen, setDuePanelOpen] = useState(false);
  const [dueCards, setDueCards] = useState<DueReviewCard[]>([]);
  const [dueLoaded, setDueLoaded] = useState(false);
  const [dueLoading, setDueLoading] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);
  const [selectedDueKeys, setSelectedDueKeys] = useState<string[]>([]);
  const [corrections, setCorrections] = useState<DisplayCoachCorrection[]>([]);
  const [shadowingId, setShadowingId] = useState<string | null>(null);
  const [sessionInsights, setSessionInsights] = useState<SessionInsights | null>(null);
  const sessionTurns = useRef<TranscriptTurn[]>([]);
  const sessionCorrections = useRef<CoachCorrection[]>([]);
  const speechActiveMs = useRef(0);
  const sessionStartedAt = useRef<number | null>(null);
  const nextCorrectionId = useRef(0);
  const notifyVoiceState = useCallback(
    (nextState: VoiceSessionState) => {
      setState(nextState);
      onVoiceStateChange?.(nextState);
    },
    [onVoiceStateChange],
  );
  useEffect(
    () => () => {
      session.current?.stop();
      session.current = null;
    },
    [],
  );
  useEffect(() => {
    const box = transcriptBox.current;
    if (!followTranscript.current || !box) return;
    const scroll = () => {
      const current = transcriptBox.current;
      if (followTranscript.current && current)
        current.scrollTop = Math.max(0, current.scrollHeight - current.clientHeight);
    };
    const useAnimationFrame = typeof window.requestAnimationFrame === 'function';
    const scheduled = useAnimationFrame
      ? window.requestAnimationFrame(scroll)
      : window.setTimeout(scroll, 0);
    return () => {
      if (useAnimationFrame) window.cancelAnimationFrame(scheduled);
      else window.clearTimeout(scheduled);
    };
  }, [turns, interim]);

  const active = ['listening', 'thinking', 'speaking', 'reconnecting'].includes(state);
  const selectedDueCards = dueCards.filter((card) => selectedDueKeys.includes(dueCardKey(card)));

  const loadDueDeck = async () => {
    if (!loadDueCards) {
      setDueError('Không thể tải danh sách thẻ ôn trong phiên này.');
      return;
    }
    setDueLoading(true);
    setDueError(null);
    try {
      const items = await loadDueCards();
      setDueCards(items);
      setDueLoaded(true);
      setSelectedDueKeys(items.slice(0, 3).map(dueCardKey));
    } catch (failure) {
      setDueError(failure instanceof Error ? failure.message : 'Không tải được thẻ đến hạn.');
    } finally {
      setDueLoading(false);
    }
  };

  const toggleDuePanel = () => {
    if (active) return;
    if (duePanelOpen) {
      setDuePanelOpen(false);
      return;
    }
    setDuePanelOpen(true);
    if (!dueLoaded || dueError) void loadDueDeck();
  };

  const toggleDueCard = (key: string, checked: boolean) => {
    setSelectedDueKeys((previous) => {
      if (checked) return previous.length >= 3 ? previous : [...previous, key];
      return previous.filter((item) => item !== key);
    });
  };

  const stopSession = () => {
    const report = buildSessionInsights(
      sessionTurns.current,
      speechActiveMs.current,
      sessionCorrections.current,
    );
    setSessionInsights(report);
    sessionStartedAt.current = null;
    session.current?.stop();
    notifyVoiceState('idle');
    setInterim('');
  };

  const start = () => {
    setError(null);
    setSessionInsights(null);
    sessionTurns.current = [];
    sessionCorrections.current = [];
    speechActiveMs.current = 0;
    sessionStartedAt.current = performance.now();
    setShadowingId(null);
    session.current?.stop();
    const sessionContext: TutorSessionContext = {
      scenario,
      coachingEnabled,
      focusWords: selectedDueCards.map((card) => ({ word: card.word, meaningVi: card.meaning_vi })),
    };
    session.current = sessionFactory({
      sessionContext,
      onStateChange: notifyVoiceState,
      onTranscript: (speaker, transcript, final) => {
        if (final) {
          const turn = { id: `turn-${++nextTurnId.current}`, speaker, text: transcript } as const;
          sessionTurns.current = [...sessionTurns.current.slice(-49), turn];
          setTurns((previous) => [...previous.slice(-49), turn]);
          setInterim('');
          if (speaker === 'user') setShadowingId(null);
        } else setInterim(`${speaker === 'user' ? 'You' : 'AI Tutor'}: ${transcript}`);
      },
      onAudioChunk: () => {},
      onSpeechActivity: (durationMs) => {
        if (sessionStartedAt.current === null || !Number.isFinite(durationMs) || durationMs <= 0)
          return;
        speechActiveMs.current += durationMs;
      },
      onCoachCorrection: (correction) => {
        sessionCorrections.current = [...sessionCorrections.current.slice(-19), correction];
        const matchingTurn = [...sessionTurns.current]
          .reverse()
          .find(
            (turn) =>
              turn.speaker === 'user' &&
              normalizeVocabularyQuestion(turn.text) ===
                normalizeVocabularyQuestion(correction.source_excerpt),
          );
        if (!matchingTurn) return;
        const displayed: DisplayCoachCorrection = {
          ...correction,
          id: `coach-${++nextCorrectionId.current}`,
          turnId: matchingTurn.id,
        };
        setCorrections((previous) => [...previous.slice(-49), displayed]);
      },
      onError: (message) => {
        sessionStartedAt.current = null;
        setError(message);
      },
      onClarificationNeeded: () =>
        onToast?.('Chưa xác định được từ cần lưu. Hãy hỏi lại bằng tên từ cụ thể.', 'warning'),
    });
    void session.current.start();
  };
  const handleTranscriptScroll = () => {
    const box = transcriptBox.current;
    if (!box) return;
    const atLatest = box.scrollHeight - box.scrollTop - box.clientHeight <= 24;
    followTranscript.current = atLatest;
    setFollowingTranscript(atLatest);
  };
  const scrollToLatest = () => {
    followTranscript.current = true;
    const box = transcriptBox.current;
    if (box) box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight);
    setFollowingTranscript(true);
  };
  const requestTranslation = useCallback(
    async (turn: TranscriptTurn) => {
      const existing = translations[turn.id];
      if (existing?.status === 'loading') return;
      if (existing?.status === 'ready' && existing.text) {
        setTranslations((previous) => ({
          ...previous,
          [turn.id]: { ...existing, visible: !existing.visible },
        }));
        return;
      }
      const updateTranslation = (value: TurnTranslation) =>
        setTranslations((previous) => {
          const next = { ...previous, [turn.id]: value };
          const ids = Object.keys(next);
          if (ids.length > 50) delete next[ids[0]!];
          return next;
        });
      updateTranslation({ status: 'loading' });
      try {
        updateTranslation({ status: 'ready', text: await translateText(turn.text), visible: true });
      } catch (failure) {
        updateTranslation({
          status: 'failed',
          error:
            failure instanceof Error ? failure.message : 'Không dịch được câu này. Hãy thử lại.',
        });
      }
    },
    [translateText, translations],
  );
  return (
    <section className="voice-panel" aria-label="Voice Conversation Session">
      <section className="tutor-session-tools" aria-label="Thiết lập hội thoại">
        <div className="tutor-tools-heading">
          <div>
            <h2>Hội thoại hôm nay</h2>
            <p>Chọn tình huống và cách luyện trước khi bắt đầu.</p>
          </div>
          <AppIcon name="voice" size={24} />
        </div>
        <div className="tutor-session-settings">
          <label className="roleplay-select">
            <span>Tình huống</span>
            <select
              data-testid="roleplay-select"
              value={scenario}
              disabled={active || !enabled}
              onChange={(event) => setScenario(event.target.value as TutorRoleplayScenario)}
            >
              {ROLEPLAY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="coaching-toggle">
            <input
              type="checkbox"
              data-testid="coaching-toggle"
              checked={coachingEnabled}
              disabled={active || !enabled}
              onChange={(event) => setCoachingEnabled(event.target.checked)}
            />
            <span>
              <strong>Sửa câu nhẹ nhàng</strong>
              <small>Gợi ý câu tự nhiên và cụm để nhại lại</small>
            </span>
          </label>
        </div>
        <div className="active-srs-row">
          <div>
            <strong>Luyện từ đến hạn</strong>
            <p>Đưa tối đa 3 từ vào tình huống hội thoại.</p>
          </div>
          <button
            type="button"
            className="btn-secondary btn-outline-success"
            data-testid="btn-active-srs"
            aria-expanded={duePanelOpen}
            disabled={active || !enabled || dueLoading}
            onClick={toggleDuePanel}
          >
            <AppIcon name={dueLoading ? 'clock' : 'review'} size={18} />
            {dueLoading ? 'Đang tải…' : duePanelOpen ? 'Ẩn từ ôn tập' : 'Chọn từ ôn tập'}
          </button>
        </div>
        {duePanelOpen && (
          <div className="active-srs-picker" data-testid="active-srs-picker">
            {dueError && (
              <div className="active-srs-error" role="alert">
                <span>{dueError}</span>
                <button
                  type="button"
                  className="btn-secondary btn-outline-danger"
                  disabled={dueLoading}
                  onClick={() => void loadDueDeck()}
                >
                  Thử lại
                </button>
              </div>
            )}
            {!dueError && dueLoading && <p role="status">Đang tải thẻ đến hạn…</p>}
            {!dueError && dueLoaded && dueCards.length === 0 && (
              <p role="status">Hôm nay chưa có thẻ đến hạn. Bạn vẫn có thể chọn hội thoại tự do.</p>
            )}
            {!dueError && dueCards.length > 0 && (
              <>
                <p className="active-srs-count">
                  {dueCards.length} thẻ đến hạn · đã chọn {selectedDueCards.length}/3
                </p>
                <div className="active-srs-options">
                  {dueCards.slice(0, 8).map((card) => {
                    const key = dueCardKey(card);
                    const checked = selectedDueKeys.includes(key);
                    return (
                      <label
                        key={key}
                        className={`active-srs-option ${checked ? 'is-selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && selectedDueKeys.length >= 3}
                          onChange={(event) => toggleDueCard(key, event.target.checked)}
                        />
                        <span>
                          <strong>{card.word}</strong>
                          <small>{card.meaning_vi}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {dueCards.length > 8 && (
                  <small>Hiển thị 8 thẻ đầu tiên trong danh sách đến hạn.</small>
                )}
              </>
            )}
          </div>
        )}
      </section>
      <VoiceStatusBadge state={state} />
      {error && (
        <div role="alert" className="voice-error-banner" data-testid="mic-error-banner">
          {error}
        </div>
      )}
      <div className="voice-controls">
        {active ? (
          <button
            type="button"
            className="btn-danger"
            data-testid="btn-stop-mic"
            onClick={stopSession}
          >
            <AppIcon name="stop" size={19} /> Stop Microphone
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            data-testid="btn-start-mic"
            disabled={!enabled}
            onClick={start}
          >
            <AppIcon name="mic" size={20} /> Start Microphone
          </button>
        )}
      </div>
      {sessionInsights && <SessionInsightsCard report={sessionInsights} />}
      <div
        ref={transcriptBox}
        className="transcript-box"
        data-testid="transcript-box"
        role="log"
        aria-label="Hội thoại"
        aria-live="polite"
        onScroll={handleTranscriptScroll}
      >
        {turns.map((turn) => (
          <TranscriptTurnRow
            key={turn.id}
            turn={turn}
            translation={translations[turn.id]}
            enabled={enabled}
            onTranslate={requestTranslation}
            correction={corrections.find((item) => item.turnId === turn.id)}
            shadowing={corrections.some(
              (item) => item.turnId === turn.id && item.id === shadowingId,
            )}
            onShadow={setShadowingId}
          />
        ))}
        {interim && <p className="transcript-interim">{interim}</p>}
      </div>
      {!followingTranscript && (
        <button
          type="button"
          className="transcript-latest-button"
          data-testid="btn-transcript-latest"
          onClick={scrollToLatest}
        >
          <AppIcon name="latest" size={18} /> Câu mới nhất
        </button>
      )}
      <form
        className="utterance-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (session.current?.sendText(text)) setText('');
          else setError('Hãy bắt đầu phiên và chờ kết nối trước khi gửi câu hỏi.');
        }}
      >
        <input
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          aria-label="Utterance transcript input"
          data-testid="utterance-input"
          placeholder="Gửi câu hỏi dạng chữ trong phiên voice..."
        />
        <button
          type="submit"
          className="btn-primary"
          data-testid="btn-send-utterance"
          disabled={!enabled || !active || state === 'reconnecting'}
        >
          <AppIcon name="send" size={18} /> Send Turn
        </button>
      </form>
    </section>
  );
}
