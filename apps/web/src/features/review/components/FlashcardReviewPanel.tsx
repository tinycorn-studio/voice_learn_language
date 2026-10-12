import { useState } from 'react';
import {
  calculateNextReview,
  type ReviewRating,
  type VocabularyItem,
} from '@voice-chat/shared';

export interface FlashcardReviewPanelProps {
  items: VocabularyItem[];
  onUpdateItem: (updated: VocabularyItem) => void;
  isOffline?: boolean | undefined;
}

export function FlashcardReviewPanel({
  items,
  onUpdateItem,
  isOffline = false,
}: FlashcardReviewPanelProps) {
  const [revealedWordId, setRevealedWordId] = useState<string | null>(null);
  const [reviewedTodayCount, setReviewedTodayCount] = useState(0);

  const activeItems = items.filter(
    (it) => it.deleted_at === '' && it.review_state !== 'suspended',
  );
  const nowMs = Date.now();
  const dueCards = activeItems.filter((it) => {
    const ms = Date.parse(it.due_at);
    return !Number.isFinite(ms) || ms <= nowMs;
  });

  const currentCard = dueCards[0] ?? null;
  const isRevealed = currentCard !== null && revealedWordId === currentCard.word_id;

  const handleGrade = (rating: ReviewRating) => {
    if (!currentCard) {
      return;
    }
    const nowIso = new Date().toISOString();
    const nextSrs = calculateNextReview(
      {
        reviewState: currentCard.review_state,
        repetitions: currentCard.repetitions,
        intervalDays: currentCard.interval_days,
        easeFactor: currentCard.ease_factor,
        dueAt: currentCard.due_at,
      },
      rating,
      nowIso,
    );

    onUpdateItem({
      ...currentCard,
      review_state: nextSrs.reviewState,
      repetitions: nextSrs.repetitions,
      interval_days: nextSrs.intervalDays,
      ease_factor: nextSrs.easeFactor,
      due_at: nextSrs.dueAt,
      last_reviewed_at: nowIso,
      version: currentCard.version + 1,
    });
    setRevealedWordId(null);
    setReviewedTodayCount((c) => c + 1);
  };

  return (
    <section className="voice-panel" aria-label="Spaced Repetition Flashcards">
      <div className="stats-grid" role="region" aria-label="Learning Progress Statistics">
        <div className="stat-card" data-testid="stat-total-words">
          <span className="stat-label">Tổng số từ</span>
          <strong className="stat-value">{activeItems.length}</strong>
        </div>
        <div className="stat-card" data-testid="stat-due-words">
          <span className="stat-label">Đến hạn ôn</span>
          <strong className="stat-value">{dueCards.length}</strong>
        </div>
        <div className="stat-card" data-testid="stat-reviewed-today">
          <span className="stat-label">Đã ôn hôm nay</span>
          <strong className="stat-value">{reviewedTodayCount}</strong>
        </div>
      </div>

      {isOffline && (
        <div className="voice-clarify-banner" role="status" data-testid="offline-review-banner">
          Bạn đang ở chế độ ngoại tuyến (Offline). Kết quả ôn tập sẽ được giữ trong phiên và đồng bộ
          khi có mạng trở lại.
        </div>
      )}

      {!currentCard ? (
        <div className="flashcard-empty" data-testid="flashcard-empty-state">
          <h2>🎉 Bạn đã hoàn thành toàn bộ thẻ ôn tập đến hạn!</h2>
          <p>
            Hệ thống sẽ nhắc bạn vào 08:00 sáng (giờ Việt Nam) trên Telegram khi có từ đến hạn mới.
          </p>
        </div>
      ) : (
        <div className="flashcard-box" data-testid="flashcard-active">
          <div className="flashcard-front">
            <span className="flashcard-pos">{currentCard.part_of_speech}</span>
            <h2 className="flashcard-word" data-testid="flashcard-word">
              {currentCard.word}
            </h2>
            {currentCard.source_excerpt && (
              <p className="flashcard-context">“{currentCard.source_excerpt}”</p>
            )}
          </div>

          {!isRevealed ? (
            <button
              type="button"
              className="btn-primary"
              aria-label="Reveal flashcard meaning and example"
              onClick={() => setRevealedWordId(currentCard.word_id)}
              data-testid="btn-reveal-answer"
            >
              Show Answer
            </button>
          ) : (
            <div className="flashcard-back" data-testid="flashcard-back">
              <p className="flashcard-meaning">
                <strong>Nghĩa:</strong> {currentCard.meaning_vi}
              </p>
              {currentCard.example && (
                <p className="flashcard-example">
                  <strong>Ví dụ:</strong> {currentCard.example}
                </p>
              )}

              <div className="srs-buttons" role="group" aria-label="Rate memory recall">
                {(
                  [
                    { rating: 'again', label: 'Again (10m)' },
                    { rating: 'hard', label: 'Hard' },
                    { rating: 'good', label: 'Good' },
                    { rating: 'easy', label: 'Easy' },
                  ] as const
                ).map((btn) => (
                  <button
                    key={btn.rating}
                    type="button"
                    className="btn-secondary"
                    aria-label={`Rate ${btn.rating}`}
                    onClick={() => handleGrade(btn.rating)}
                    data-testid={`btn-rate-${btn.rating}`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
