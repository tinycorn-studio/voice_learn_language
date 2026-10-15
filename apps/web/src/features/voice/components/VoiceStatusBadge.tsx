import type { VoiceSessionState } from '@voice-chat/shared';
import { AppIcon, type AppIconName } from '../../../components/app-icon.js';

export interface VoiceStatusBadgeProps {
  state: VoiceSessionState;
}

const STATE_LABELS: Record<
  VoiceSessionState,
  { label: string; description: string; toneClass: string; iconName: AppIconName }
> = {
  idle: {
    label: 'Idle',
    description: 'Sẵn sàng bắt đầu hội thoại',
    toneClass: 'status-idle',
    iconName: 'mic',
  },
  listening: {
    label: 'Listening',
    description: 'Micro đang bật — hãy nói tiếng Anh tự nhiên',
    toneClass: 'status-listening',
    iconName: 'voice',
  },
  thinking: {
    label: 'Thinking',
    description: 'Trợ lý đang phân tích câu nói của bạn',
    toneClass: 'status-thinking',
    iconName: 'spark',
  },
  speaking: {
    label: 'Speaking',
    description: 'Trợ lý đang phản hồi bằng giọng nói',
    toneClass: 'status-speaking',
    iconName: 'speaker',
  },
  reconnecting: {
    label: 'Reconnecting',
    description: 'Đang khôi phục phiên kết nối Gemini Live...',
    toneClass: 'status-reconnecting',
    iconName: 'again',
  },
  error: {
    label: 'Error',
    description: 'Có sự cố kết nối hoặc quyền truy cập micro',
    toneClass: 'status-error',
    iconName: 'warning',
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
      <span className="voice-status-icon" aria-hidden="true">
        <AppIcon name={meta.iconName} size={21} />
      </span>
      <span className="voice-status-dot" aria-hidden="true" />
      <div className="voice-status-copy">
        <strong className="voice-status-label">{meta.label}</strong>
        <span className="voice-status-description">{meta.description}</span>
      </div>
    </div>
  );
}
