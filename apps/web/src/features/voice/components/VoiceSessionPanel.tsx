import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationContextTurn, VoiceSessionState } from '@voice-chat/shared';
import { AppIcon } from '../../../components/app-icon.js';
import type { GeminiLiveClientCallbacks } from '../services/gemini-live-client.js';
import type { VoiceSession } from '../services/voice-session.js';
import { VoiceStatusBadge } from './VoiceStatusBadge.js';

export type VoiceSessionFactory = (
  callbacks: Omit<GeminiLiveClientCallbacks, 'onSaveVocabulary'>,
) => VoiceSession;
export interface VoiceSessionPanelProps {
  sessionFactory: VoiceSessionFactory;
  translateText: (text: string) => Promise<string>;
  enabled?: boolean;
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

interface TranscriptTurnRowProps {
  turn: TranscriptTurn;
  translation: TurnTranslation | undefined;
  enabled: boolean;
  onTranslate: (turn: TranscriptTurn) => void;
}

const TranscriptTurnRow = memo(function TranscriptTurnRow({
  turn,
  translation,
  enabled,
  onTranslate,
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
    </div>
  );
});

export function VoiceSessionPanel({
  sessionFactory,
  translateText,
  enabled = true,
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
  const [captureNotices, setCaptureNotices] = useState<Record<string, 'pending' | 'failed'>>({});
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

  const start = () => {
    setError(null);
    setCaptureNotices({});
    session.current?.stop();
    session.current = sessionFactory({
      onStateChange: setState,
      onTranscript: (speaker, transcript, final) => {
        if (final) {
          setTurns((previous) => [
            ...previous.slice(-49),
            { id: `turn-${++nextTurnId.current}`, speaker, text: transcript },
          ]);
          setInterim('');
        } else setInterim(`${speaker === 'user' ? 'You' : 'AI Tutor'}: ${transcript}`);
      },
      onAudioChunk: () => {},
      onError: setError,
      onVocabularyCaptureStatus: ({ word, status }) =>
        setCaptureNotices((previous) => {
          const next = { ...previous };
          if (status === 'saved') delete next[word];
          else next[word] = status;
          const oldest = Object.keys(next)[0];
          if (Object.keys(next).length > 30 && oldest) delete next[oldest];
          return next;
        }),
      onClarificationNeeded: () =>
        setError('Chưa xác định đúng từ cần lưu. Hãy hỏi lại bằng tên từ cụ thể.'),
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
  const active = ['listening', 'thinking', 'speaking', 'reconnecting'].includes(state);
  return (
    <section className="voice-panel" aria-label="Voice Conversation Session">
      <VoiceStatusBadge state={state} />
      {Object.keys(captureNotices).length > 0 && (
        <div role="status" data-testid="vocabulary-capture-notice">
          {Object.entries(captureNotices)
            .slice(-3)
            .map(([word, status]) => (
              <p key={word}>
                {status === 'pending'
                  ? `Đang ghi nhận từ: ${word}…`
                  : `Chưa xác nhận lưu từ ${word}. Kiểm tra trạng thái đồng bộ hoặc hỏi lại tên từ cụ thể.`}
              </p>
            ))}
        </div>
      )}
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
            onClick={() => {
              session.current?.stop();
              setInterim('');
              setCaptureNotices({});
            }}
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
