import { useEffect, useRef, useState } from 'react';
import type { ConversationContextTurn, VoiceSessionState } from '@voice-chat/shared';
import type { GeminiLiveClientCallbacks } from '../services/gemini-live-client.js';
import type { VoiceSession } from '../services/voice-session.js';
import { VoiceStatusBadge } from './VoiceStatusBadge.js';

export type VoiceSessionFactory = (
  callbacks: Omit<GeminiLiveClientCallbacks, 'onSaveVocabulary'>,
) => VoiceSession;
export interface VoiceSessionPanelProps {
  sessionFactory: VoiceSessionFactory;
  enabled?: boolean;
}

export function VoiceSessionPanel({ sessionFactory, enabled = true }: VoiceSessionPanelProps) {
  const session = useRef<VoiceSession | null>(null);
  const [state, setState] = useState<VoiceSessionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationContextTurn[]>([]);
  const [interim, setInterim] = useState('');
  const [text, setText] = useState('');
  useEffect(
    () => () => {
      session.current?.stop();
      session.current = null;
    },
    [],
  );

  const start = () => {
    setError(null);
    session.current?.stop();
    session.current = sessionFactory({
      onStateChange: setState,
      onTranscript: (speaker, transcript, final) => {
        if (final) {
          setTurns((previous) => [...previous.slice(-49), { speaker, text: transcript }]);
          setInterim('');
        } else setInterim(`${speaker === 'user' ? 'You' : 'AI Tutor'}: ${transcript}`);
      },
      onAudioChunk: () => {},
      onError: setError,
      onClarificationNeeded: () =>
        setError('Chưa xác định đúng từ cần lưu. Hãy hỏi lại bằng tên từ cụ thể.'),
    });
    void session.current.start();
  };
  const active = ['listening', 'thinking', 'speaking', 'reconnecting'].includes(state);
  return (
    <section className="voice-panel" aria-label="Voice Conversation Session">
      <VoiceStatusBadge state={state} />
      {error && (
        <div role="alert" className="voice-error-banner" data-testid="mic-error-banner">
          {error}
        </div>
      )}
      <div className="voice-controls">
        {active ? (
          <button
            className="btn-danger"
            data-testid="btn-stop-mic"
            onClick={() => {
              session.current?.stop();
              setInterim('');
            }}
          >
            Stop Microphone
          </button>
        ) : (
          <button
            className="btn-primary"
            data-testid="btn-start-mic"
            disabled={!enabled}
            onClick={start}
          >
            Start Microphone
          </button>
        )}
      </div>
      <div className="transcript-box" data-testid="transcript-box" aria-live="polite">
        {turns.map((turn, index) => (
          <div key={index} className={`transcript-turn turn-${turn.speaker}`}>
            <strong>{turn.speaker === 'user' ? 'You' : 'AI Tutor'}:</strong> {turn.text}
          </div>
        ))}
        {interim && <p>{interim}</p>}
      </div>
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
          className="btn-secondary"
          data-testid="btn-send-utterance"
          disabled={!enabled || !active || state === 'reconnecting'}
        >
          Send Turn
        </button>
      </form>
    </section>
  );
}
