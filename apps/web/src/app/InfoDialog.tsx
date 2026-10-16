import { useEffect, useRef } from 'react';
import type { ThemePreference } from '../integrations/telegram/telegram-adapter.js';
import { AppIcon } from '../components/app-icon.js';

export function InfoDialog({
  onClose,
  themePreference,
  themeLabel,
  onUseAuto,
}: {
  onClose: () => void;
  themePreference: ThemePreference;
  themeLabel: string;
  onUseAuto: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="info-modal-backdrop"
      data-testid="info-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-modal-title"
        tabIndex={-1}
      >
        <div className="info-modal-header">
          <div>
            <p className="info-modal-eyebrow">VOICECHAT ENGLISH TUTOR</p>
            <h2 id="info-modal-title">Hướng dẫn & quyền riêng tư</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="info-modal-close"
            data-testid="info-close-button"
            aria-label="Đóng hướng dẫn"
            onClick={onClose}
          >
            <AppIcon name="close" size={20} />
          </button>
        </div>
        <div className="info-modal-content">
          <section>
            <h3>Cách bắt đầu</h3>
            <p>
              Bấm <strong>Start Microphone</strong> để bắt đầu hội thoại tiếng Anh với Gemini. Chọn{' '}
              <strong>Dịch</strong> dưới từng câu nếu bạn muốn dịch riêng câu đó.
            </p>
          </section>
          <section>
            <h3>Quyền riêng tư</h3>
            <p>
              Ứng dụng không lưu toàn bộ audio, transcript hoặc bản dịch. Nội dung được gửi đến Gemini
              tuân theo chính sách của Google theo tier đang dùng.
            </p>
          </section>
          <section className="theme-preference-row" aria-label="Chế độ giao diện">
            <span>
              Giao diện: <strong>{themePreference === 'auto' ? 'Tự động' : themeLabel}</strong>
            </span>
            <button
              type="button"
              className="btn-secondary btn-outline-info"
              data-testid="theme-auto-button"
              disabled={themePreference === 'auto'}
              onClick={onUseAuto}
            >
              Dùng theme Telegram/thiết bị
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
