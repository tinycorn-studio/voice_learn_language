import { useMemo } from 'react';
import { initTelegramEnvironment } from '../integrations/telegram/telegram-adapter.js';
import { VoiceSessionPanel } from '../features/voice/components/VoiceSessionPanel.js';

export function App() {
  const tgEnv = useMemo(() => initTelegramEnvironment(), []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">VoiceChat English Tutor</h1>
          <p className="app-subtitle">
            Gemini Live Voice • Google Sheets Sync • Telegram Spaced Repetition
          </p>
        </div>
        <div className="env-pill" data-testid="env-mode-pill">
          {tgEnv.isTelegramMiniApp
            ? `Telegram Mini App (${tgEnv.platform})`
            : 'Local Dev Browser Mode'}
        </div>
      </header>

      <div className="privacy-notice" role="note">
        <strong>Lưu ý quyền riêng tư:</strong> Phiên âm thanh dùng Gemini API Free Tier chỉ bắt đầu
        sau khi bạn bấm <em>Start Microphone</em> và dừng ngay lập tức khi bấm <em>Stop</em>.
      </div>

      <VoiceSessionPanel />
    </main>
  );
}
