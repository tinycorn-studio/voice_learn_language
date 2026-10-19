import { useCallback, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../../../components/app-icon.js';
import {
  createDefaultRecognizer,
  speakReply,
  stopSpeaking,
  type LiteRecognizerFactory,
  type LiteSpeechErrorEvent,
  type LiteSpeechRecognizer,
} from '../services/lite-speech.js';

type LiteTurnRole = 'learner' | 'tutor';

interface LiteTurn {
  id: string;
  role: LiteTurnRole;
  text: string;
  failed?: boolean;
}

export interface LiteConversationPanelProps {
  enabled: boolean;
  chatTurn: (
    message: string,
    history: Array<{ role: LiteTurnRole; text: string }>,
  ) => Promise<string>;
  createRecognizer?: LiteRecognizerFactory;
  speak?: (text: string) => void;
}

/** Keeps the in-memory log bounded; conversations are never persisted or sent as a whole. */
const MAX_TURNS = 20;
const MAX_HISTORY_TURNS = 6;

function boundTurns(turns: LiteTurn[]): LiteTurn[] {
  return turns.length > MAX_TURNS ? turns.slice(turns.length - MAX_TURNS) : turns;
}

function historyFrom(turns: LiteTurn[]): Array<{ role: LiteTurnRole; text: string }> {
  return turns
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 300) }));
}

function describeFailure(failure: unknown): string {
  if (failure instanceof Error && failure.message.trim()) return failure.message;
  return 'Không thể gửi lượt này. Hãy thử lại.';
}

function describeMicFailure(event: LiteSpeechErrorEvent): string {
  switch (event.error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Trình duyệt chưa được cấp quyền micro. Hãy kiểm tra quyền truy cập.';
    case 'no-speech':
      return 'Không nghe thấy giọng nói. Hãy thử lại.';
    case 'audio-capture':
      return 'Không tìm thấy micro trên thiết bị.';
    default:
      return 'Không nhận dạng được giọng nói. Hãy thử lại.';
  }
}

export function LiteConversationPanel({
  enabled,
  chatTurn,
  createRecognizer = createDefaultRecognizer,
  speak = speakReply,
}: LiteConversationPanelProps) {
  const [turns, setTurns] = useState<LiteTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(true);
  const recognizerRef = useRef<LiteSpeechRecognizer | null>(null);
  const nextTurnId = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const [micSupported] = useState(() => {
    const created = createRecognizer();
    recognizerRef.current = created;
    return created !== null;
  });
  const speakRepliesRef = useRef(speakReplies);

  useEffect(() => {
    speakRepliesRef.current = speakReplies;
    if (!speakReplies) stopSpeaking();
  }, [speakReplies]);

  useEffect(() => {
    const recognizer = recognizerRef.current;
    return () => {
      if (recognizer) {
        recognizer.onresult = null;
        recognizer.onerror = null;
        recognizer.onend = null;
        try {
          recognizer.abort();
        } catch {
          // The recognizer may already be stopped by the WebView.
        }
      }
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns, pending]);

  const performTurn = useCallback(
    async (message: string, baseTurns: LiteTurn[]) => {
      const history = historyFrom(baseTurns);
      const learnerTurn: LiteTurn = {
        id: `turn-${++nextTurnId.current}`,
        role: 'learner',
        text: message,
      };
      setTurns(boundTurns([...baseTurns, learnerTurn]));
      setPending(true);
      setError(null);
      try {
        const reply = await chatTurn(message, history);
        setTurns((previous) =>
          boundTurns([
            ...previous,
            { id: `turn-${++nextTurnId.current}`, role: 'tutor', text: reply },
          ]),
        );
        if (speakRepliesRef.current) speak(reply);
      } catch (failure) {
        setTurns((previous) =>
          previous.map((turn) => (turn.id === learnerTurn.id ? { ...turn, failed: true } : turn)),
        );
        setError(describeFailure(failure));
      } finally {
        setPending(false);
      }
    },
    [chatTurn, speak],
  );

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || pending || !enabled) return;
      setDraft('');
      void performTurn(message, turns);
    },
    [enabled, pending, performTurn, turns],
  );

  const retryLast = useCallback(() => {
    if (pending || !enabled) return;
    let failedIndex = -1;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (turns[index]?.failed) {
        failedIndex = index;
        break;
      }
    }
    const failedTurn = turns[failedIndex];
    if (!failedTurn) return;
    const baseTurns = turns.filter((_turn, index) => index !== failedIndex);
    void performTurn(failedTurn.text, baseTurns);
  }, [enabled, pending, performTurn, turns]);

  const toggleListening = useCallback(() => {
    if (!enabled || pending) return;
    const recognizer = recognizerRef.current;
    if (!recognizer) return;
    if (listening) {
      try {
        recognizer.stop();
      } catch {
        // Some WebViews throw when the recognizer already ended.
      }
      setListening(false);
      return;
    }
    setError(null);
    const baseTurns = turns;
    recognizer.onresult = (event) => {
      setListening(false);
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) void performTurn(transcript, baseTurns);
    };
    recognizer.onerror = (event) => {
      setListening(false);
      setError(describeMicFailure(event));
    };
    recognizer.onend = () => setListening(false);
    try {
      recognizer.start();
      setListening(true);
    } catch {
      setError('Không thể bật micro. Hãy thử lại hoặc nhập chữ.');
    }
  }, [enabled, listening, pending, performTurn, turns]);

  const inputDisabled = !enabled || pending;

  return (
    <section className="voice-panel lite-chat" aria-label="Chế độ hội thoại nhẹ">
      <div className="lite-chat-log" ref={logRef} data-testid="lite-chat-log" aria-live="polite">
        {turns.length === 0 && (
          <p className="lite-hint" data-testid="lite-empty-hint">
            Bấm nút micro để nói hoặc nhập câu tiếng Anh bên dưới. Chế độ nhẹ không mở phiên Gemini
            Live nên vẫn dùng được khi quota Live đã hết.
          </p>
        )}
        {turns.map((turn) => (
          <p
            key={turn.id}
            className={`lite-turn lite-turn-${turn.role}${turn.failed ? ' lite-turn-failed' : ''}`}
            data-testid={`lite-turn-${turn.role}`}
            data-failed={turn.failed ? 'true' : undefined}
          >
            {turn.text}
          </p>
        ))}
        {pending && (
          <p className="lite-turn lite-turn-tutor lite-turn-pending" role="status">
            Đang trả lời…
          </p>
        )}
      </div>
      {error && (
        <div className="lite-error" role="alert" data-testid="lite-error">
          <p>{error}</p>
          <button
            type="button"
            className="btn-secondary btn-outline-info"
            data-testid="lite-retry"
            disabled={pending || !enabled}
            onClick={retryLast}
          >
            <AppIcon name="again" size={18} /> Gửi lại
          </button>
        </div>
      )}
      <form
        className="lite-chat-input-row"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={500}
          placeholder="Nhập câu tiếng Anh…"
          aria-label="Câu hội thoại"
          data-testid="lite-input"
          disabled={inputDisabled}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="btn-primary"
          data-testid="lite-send"
          disabled={inputDisabled || draft.trim().length === 0}
        >
          <AppIcon name="send" size={18} /> Gửi
        </button>
      </form>
      <div className="lite-chat-controls">
        {micSupported ? (
          <button
            type="button"
            className={`btn-secondary lite-mic-btn${listening ? ' listening' : ''}`}
            data-testid="lite-mic"
            aria-pressed={listening}
            disabled={inputDisabled}
            onClick={toggleListening}
          >
            <AppIcon name="mic" size={20} />
            {listening ? 'Đang nghe… bấm để dừng' : 'Nói'}
          </button>
        ) : (
          <p className="lite-hint" data-testid="lite-mic-unsupported">
            Thiết bị/trình duyệt này chưa hỗ trợ nhận giọng nói — hãy nhập chữ.
          </p>
        )}
        <label className="lite-tts-toggle">
          <input
            type="checkbox"
            checked={speakReplies}
            data-testid="lite-tts"
            onChange={(event) => setSpeakReplies(event.target.checked)}
          />
          Đọc câu trả lời
        </label>
      </div>
      <p className="lite-hint">
        Câu của bạn chỉ được gửi đến Gemini khi bấm Gửi hoặc khi micro trả kết quả; hội thoại không
        được lưu trên máy chủ.
      </p>
    </section>
  );
}
