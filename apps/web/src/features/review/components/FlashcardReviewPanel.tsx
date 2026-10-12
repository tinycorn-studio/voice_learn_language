import { useEffect, useState } from 'react';
import { type ReviewRating, type VocabularyItem } from '@voice-chat/shared';

export interface FlashcardReviewPanelProps {
  items: VocabularyItem[];
  onGrade: (wordId: string, rating: ReviewRating, eventId: string) => Promise<void>;
  enabled?: boolean;
}

export function FlashcardReviewPanel({
  items,
  onGrade,
  enabled = true,
}: FlashcardReviewPanelProps) {
  const [revealedWordId, setRevealedWordId] = useState<string | null>(null);
  const [reviewedTodayCount, setReviewedTodayCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    wordId: string;
    rating: ReviewRating;
    eventId: string;
  } | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const activeItems = items.filter((it) => it.deleted_at === '' && it.review_state !== 'suspended');
  const dueCards = activeItems.filter((it) => {
    const ms = Date.parse(it.due_at);
    return !Number.isFinite(ms) || ms <= nowMs;
  });

  const currentCard = dueCards[0] ?? null;
  const isRevealed = currentCard !== null && revealedWordId === currentCard.word_id;

  const handleGrade = async (rating: ReviewRating) => {
    if (!currentCard || busy || !enabled) {
      return;
    }
    const operation = pending ?? {
      wordId: currentCard.word_id,
      rating,
      eventId: crypto.randomUUID(),
    };
    setPending(operation);
    setBusy(true);
    setError(null);
    try {
      await onGrade(operation.wordId, operation.rating, operation.eventId);
      setPending(null);
      setRevealedWordId(null);
      setReviewedTodayCount((count) => count + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không thể lưu kết quả ôn.');
    } finally {
      setBusy(false);
    }
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
          <span className="stat-label">Đã ôn phiên này</span>
          <strong className="stat-value">{reviewedTodayCount}</strong>
        </div>
      </div>

      {error && (
        <div className="voice-clarify-banner" role="status" data-testid="offline-review-banner">
          {error} Chưa xác nhận lưu kết quả. Nhấn lại mức đánh giá để thử cùng sự kiện.
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
                    disabled={
                      !enabled || busy || (pending !== null && pending.rating !== btn.rating)
                    }
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
