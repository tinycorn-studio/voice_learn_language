import { useEffect, useRef, useState } from 'react';
import {
  detectVocabularyIntent,
  type ConversationContextTurn,
  type VoiceSessionState,
} from '@voice-chat/shared';
import {
  AudioSessionController,
  type MediaDevicesLike,
  type MicPermissionState,
} from '../services/audio-session-controller.js';
import { VoiceStatusBadge } from './VoiceStatusBadge.js';

export interface SavedWordBadgeItem {
  eventId: string;
  word: string;
  meaningVi: string;
  status: 'pending' | 'saved' | 'error';
}

export interface VoiceSessionPanelProps {
  mediaDevices?: MediaDevicesLike | undefined;
  initialState?: VoiceSessionState | undefined;
  onWordDetected?: ((word: string, sourceExcerpt: string) => void) | undefined;
}

export function VoiceSessionPanel({
  mediaDevices = typeof navigator !== 'undefined'
    ? (navigator.mediaDevices as unknown as MediaDevicesLike | undefined)
    : undefined,
  initialState = 'idle',
  onWordDetected,
}: VoiceSessionPanelProps) {
  const controllerRef = useRef<AudioSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AudioSessionController(mediaDevices);
  }

  const [sessionState, setSessionState] = useState<VoiceSessionState>(initialState);
  const [micPermission, setMicPermission] = useState<MicPermissionState>(() =>
    controllerRef.current ? controllerRef.current.getPermissionState() : 'prompt',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationContextTurn[]>([
    {
      speaker: 'assistant',
      text: 'Hello! Tap Start Microphone to practice English conversation, or ask "What does <word> mean?" to save vocabulary.',
      highlightedTerms: ['resilient'],
    },
  ]);
  const [utteranceInput, setUtteranceInput] = useState('');
  const [clarificationPrompt, setClarificationPrompt] = useState<string | null>(null);
  const [savedBadges, setSavedBadges] = useState<SavedWordBadgeItem[]>([]);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      controller?.stop();
    };
  }, []);

  const handleStartMicrophone = async () => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    setErrorMessage(null);
    const result = await controller.requestMicrophone();
    setMicPermission(result.permission);
    if (!result.ok) {
      setSessionState('error');
      setErrorMessage(result.errorMessage);
      return;
    }
    setSessionState('listening');
  };

  const handleStopMicrophone = () => {
    controllerRef.current?.stop();
    setSessionState('idle');
    setErrorMessage(null);
  };

  const handleSendUtterance = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = utteranceInput.trim();
    if (!trimmed) {
      return;
    }

    const decision = detectVocabularyIntent(trimmed, turns);
    const nextTurns: ConversationContextTurn[] = [...turns, { speaker: 'user', text: trimmed }];
    setUtteranceInput('');

    if (decision.status === 'save' && decision.targetWord) {
      const targetWord = decision.targetWord;
      const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setClarificationPrompt(null);
      setSavedBadges((prev) => [
        {
          eventId,
          word: targetWord,
          meaningVi: 'Đang đồng bộ nghĩa tiếng Việt...',
          status: 'saved',
        },
        ...prev.slice(0, 4),
      ]);
      onWordDetected?.(targetWord, decision.sourceExcerpt);
      nextTurns.push({
        speaker: 'assistant',
        text: `Great question! "${targetWord}" has been noted in your vocabulary list.`,
        highlightedTerms: [targetWord],
      });
    } else if (decision.status === 'clarify') {
      const msg =
        'Mình chưa rõ bạn đang hỏi từ nào ("that/it" có nhiều hơn 1 khả năng hoặc chưa có từ trước đó). Bạn muốn hỏi từ cụ thể nào?';
      setClarificationPrompt(msg);
      nextTurns.push({
        speaker: 'assistant',
        text: 'Could you clarify which exact word you mean? I want to make sure I save the right one.',
      });
    } else {
      setClarificationPrompt(null);
      nextTurns.push({
        speaker: 'assistant',
        text: 'That sounds natural! Keep going—tell me more about your day.',
      });
    }

    setTurns(nextTurns);
  };

  const isActive =
    sessionState === 'listening' ||
    sessionState === 'thinking' ||
    sessionState === 'speaking' ||
    sessionState === 'reconnecting';

  return (
    <section className="voice-panel" aria-label="Voice Conversation Session">
      <div className="voice-panel-header">
        <VoiceStatusBadge state={sessionState} />
        <div className="mic-permission-pill" data-testid="mic-permission-state">
          Mic: <strong>{micPermission}</strong>
        </div>
      </div>

      {errorMessage && (
        <div className="voice-error-banner" role="alert" data-testid="mic-error-banner">
          {errorMessage}
        </div>
      )}

      {clarificationPrompt && (
        <div className="voice-clarify-banner" role="status" data-testid="clarification-banner">
          {clarificationPrompt}
        </div>
      )}

      <div className="voice-controls">
        {!isActive ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleStartMicrophone()}
            data-testid="btn-start-mic"
          >
            Start Microphone
          </button>
        ) : (
          <button
            type="button"
            className="btn-danger"
            onClick={handleStopMicrophone}
            data-testid="btn-stop-mic"
          >
            Stop Microphone
          </button>
        )}

        <div className="state-simulator" aria-label="Session state preview">
          {(['idle', 'listening', 'thinking', 'speaking', 'reconnecting', 'error'] as const).map(
            (st) => (
              <button
                key={st}
                type="button"
                className={`btn-chip ${sessionState === st ? 'active' : ''}`}
                onClick={() => setSessionState(st)}
                data-testid={`btn-state-${st}`}
              >
                {st}
              </button>
            ),
          )}
        </div>
      </div>

      {savedBadges.length > 0 && (
        <div className="saved-badges-bar" aria-label="Recently saved vocabulary">
          {savedBadges.map((item) => (
            <span
              key={item.eventId}
              className={`saved-mini-badge status-${item.status}`}
              data-testid="saved-word-badge"
            >
              ✓ Saved: <strong>{item.word}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="transcript-box" data-testid="transcript-box">
        {turns.map((turn, idx) => (
          <div key={idx} className={`transcript-turn turn-${turn.speaker}`}>
            <span className="turn-speaker">{turn.speaker === 'user' ? 'You' : 'AI Tutor'}:</span>{' '}
            <span className="turn-text">{turn.text}</span>
          </div>
        ))}
      </div>

      <form className="utterance-form" onSubmit={handleSendUtterance}>
        <input
          type="text"
          value={utteranceInput}
          onChange={(e) => setUtteranceInput(e.target.value)}
          placeholder='Thử nhập câu nói (vd: "What does overwhelmed mean?")...'
          aria-label="Utterance transcript input"
          data-testid="utterance-input"
        />
        <button type="submit" className="btn-secondary" data-testid="btn-send-utterance">
          Send Turn
        </button>
      </form>
    </section>
  );
}
