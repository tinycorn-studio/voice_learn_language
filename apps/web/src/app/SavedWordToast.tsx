import { useCallback, useEffect, useRef } from 'react';
import { AppIcon } from '../components/app-icon.js';

export interface SavedWordToastProps {
  id: string;
  word: string;
  onDismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 5000;

/** Announces a successful save and pauses its timeout while the toast is hovered or focused. */
export function SavedWordToast({ id, word, onDismiss }: SavedWordToastProps) {
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

  return (
    <div
      className="saved-toast"
      data-testid="saved-word-toast"
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
      <AppIcon name="good" size={20} />
      <span>
        <strong>{word}</strong> đã lưu
      </span>
      <button
        type="button"
        className="saved-toast-close"
        aria-label={`Đóng thông báo lưu từ ${word}`}
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
