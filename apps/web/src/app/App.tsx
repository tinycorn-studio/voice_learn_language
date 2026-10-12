import { useMemo, useState } from 'react';
import type { VocabularyItem } from '@voice-chat/shared';
import { initTelegramEnvironment } from '../integrations/telegram/telegram-adapter.js';
import { VoiceSessionPanel } from '../features/voice/components/VoiceSessionPanel.js';
import { FlashcardReviewPanel } from '../features/review/components/FlashcardReviewPanel.js';
import { VocabularyManagerPanel } from '../features/vocabulary/components/VocabularyManagerPanel.js';

type ActiveTab = 'voice' | 'review' | 'vocabulary';

const INITIAL_SAMPLE_WORDS: VocabularyItem[] = [
  {
    word_id: 'w_seed_1',
    user_id: 'telegram:local',
    word_key: 'telegram:local|overwhelmed|adjective|feeling_unable_to_cope',
    word: 'overwhelmed',
    lemma: 'overwhelmed',
    part_of_speech: 'adjective',
    sense_key: 'feeling_unable_to_cope',
    meaning_vi: 'quá tải, choáng ngợp',
    ipa: '/ˌəʊ.vəˈwelmd/',
    example: 'I feel overwhelmed by the tight schedule.',
    source_excerpt: 'What does overwhelmed mean?',
    created_at: '2026-10-12T00:00:00.000Z',
    last_asked_at: '2026-10-12T00:00:00.000Z',
    times_asked: 1,
    review_state: 'new',
    repetitions: 0,
    interval_days: 0,
    ease_factor: 2.5,
    due_at: '2026-10-12T00:00:00.000Z',
    last_reviewed_at: '',
    version: 1,
    deleted_at: '',
  },
];

export function App() {
  const tgEnv = useMemo(() => initTelegramEnvironment(), []);
  const [activeTab, setActiveTab] = useState<ActiveTab>('voice');
  const [words, setWords] = useState<VocabularyItem[]>(INITIAL_SAMPLE_WORDS);

  const handleWordDetected = (word: string, sourceExcerpt: string) => {
    const now = new Date().toISOString();
    const newItem: VocabularyItem = {
      word_id: `w_${Date.now()}`,
      user_id: 'telegram:local',
      word_key: `telegram:local|${word.toLowerCase()}|unknown|default`,
      word,
      lemma: word.toLowerCase(),
      part_of_speech: 'unknown',
      sense_key: 'default',
      meaning_vi: 'Từ mới lưu từ hội thoại (có thể chỉnh sửa ở tab Vocabulary)',
      ipa: '',
      example: '',
      source_excerpt: sourceExcerpt,
      created_at: now,
      last_asked_at: now,
      times_asked: 1,
      review_state: 'new',
      repetitions: 0,
      interval_days: 0,
      ease_factor: 2.5,
      due_at: now,
      last_reviewed_at: '',
      version: 1,
      deleted_at: '',
    };
    setWords((prev) => [newItem, ...prev]);
  };

  const handleUpdateWord = (updated: VocabularyItem) => {
    setWords((prev) => prev.map((it) => (it.word_id === updated.word_id ? updated : it)));
  };

  const handleDeleteWord = (wordId: string) => {
    const now = new Date().toISOString();
    setWords((prev) =>
      prev.map((it) =>
        it.word_id === wordId ? { ...it, deleted_at: now, review_state: 'suspended' } : it,
      ),
    );
  };

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
        <strong>Hướng dẫn & Quyền riêng tư:</strong> Bấm <em>Start Microphone</em> để luyện nói;
        hỏi <em>“What does &lt;word&gt; mean?”</em> để tự động lưu từ vựng và ôn tập theo lịch
        Spaced Repetition lúc 08:00 sáng (UTC+7).
      </div>

      <nav className="app-tabs" aria-label="Main sections">
        <button
          type="button"
          className={`btn-chip ${activeTab === 'voice' ? 'active' : ''}`}
          onClick={() => setActiveTab('voice')}
          data-testid="tab-voice"
        >
          🎙 Voice Tutor
        </button>
        <button
          type="button"
          className={`btn-chip ${activeTab === 'review' ? 'active' : ''}`}
          onClick={() => setActiveTab('review')}
          data-testid="tab-review"
        >
          🃏 Flashcards SRS
        </button>
        <button
          type="button"
          className={`btn-chip ${activeTab === 'vocabulary' ? 'active' : ''}`}
          onClick={() => setActiveTab('vocabulary')}
          data-testid="tab-vocabulary"
        >
          📚 Vocabulary ({words.filter((w) => w.deleted_at === '').length})
        </button>
      </nav>

      {activeTab === 'voice' && <VoiceSessionPanel onWordDetected={handleWordDetected} />}
      {activeTab === 'review' && (
        <FlashcardReviewPanel items={words} onUpdateItem={handleUpdateWord} />
      )}
      {activeTab === 'vocabulary' && (
        <VocabularyManagerPanel
          items={words}
          onUpdateItem={handleUpdateWord}
          onDeleteItem={handleDeleteWord}
        />
      )}
    </main>
  );
}
