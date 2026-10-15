import { useCallback, useEffect, useRef } from 'react';
import { AppIcon } from '../components/app-icon.js';

export type FeedbackToastTone = 'success' | 'info' | 'warning';

export interface FeedbackToastProps {
  id: string;
  message: string;
  tone: FeedbackToastTone;
  onDismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 5000;

/** Announces short feedback without taking focus; timeout pauses while the toast is used. */
export function FeedbackToast({ id, message, tone, onDismiss }: FeedbackToastProps) {
  const timer = useRef<number | null>(null);
  const remainingMs = useRef(AUTO_DISMISS_MS);
  const startedAt = useRef(0);
  const dismiss = useCallback(() => onDismiss(id), [id, onDismiss]);

  const pause = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    remainingMs.current = Math.max(0, remainingMs.current - (Date.now() - startedAt.current));
  }, []);

  const resume = useCallback(() => {
    if (timer.current !== null || remainingMs.current <= 0) return;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(dismiss, remainingMs.current);
  }, [dismiss]);

  useEffect(() => {
    resume();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [resume]);

  const icon = tone === 'warning' ? 'warning' : tone === 'success' ? 'good' : 'info';

  return (
    <div
      className={`saved-toast feedback-toast feedback-toast-${tone}`}
      data-testid="feedback-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
      }}
    >
      <AppIcon name={icon} size={20} />
      <span>{message}</span>
      <button
        type="button"
        className="saved-toast-close"
        aria-label="Đóng thông báo"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
