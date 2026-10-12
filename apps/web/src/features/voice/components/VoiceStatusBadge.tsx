import type { VoiceSessionState } from '@voice-chat/shared';

export interface VoiceStatusBadgeProps {
  state: VoiceSessionState;
}

const STATE_LABELS: Record<
  VoiceSessionState,
  { label: string; description: string; toneClass: string }
> = {
  idle: {
    label: 'Idle',
    description: 'Sẵn sàng bắt đầu hội thoại',
    toneClass: 'status-idle',
  },
  listening: {
    label: 'Listening',
    description: 'Micro đang bật — hãy nói tiếng Anh tự nhiên',
    toneClass: 'status-listening',
  },
  thinking: {
    label: 'Thinking',
    description: 'Trợ lý đang phân tích câu nói của bạn',
    toneClass: 'status-thinking',
  },
  speaking: {
    label: 'Speaking',
    description: 'Trợ lý đang phản hồi bằng giọng nói',
    toneClass: 'status-speaking',
  },
  reconnecting: {
    label: 'Reconnecting',
    description: 'Đang khôi phục phiên kết nối Gemini Live...',
    toneClass: 'status-reconnecting',
  },
  error: {
    label: 'Error',
    description: 'Có sự cố kết nối hoặc quyền truy cập micro',
    toneClass: 'status-error',
  },
};

export function VoiceStatusBadge({ state }: VoiceStatusBadgeProps) {
  const meta = STATE_LABELS[state];
  return (
    <div
      className={`voice-status-badge ${meta.toneClass}`}
      role="status"
      aria-live="polite"
      data-testid="voice-status-badge"
      data-state={state}
    >
      <span className="voice-status-dot" aria-hidden="true" />
      <div className="voice-status-copy">
        <strong className="voice-status-label">{meta.label}</strong>
        <span className="voice-status-description">{meta.description}</span>
      </div>
    </div>
  );
}
