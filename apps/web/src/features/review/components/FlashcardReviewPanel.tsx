import { useEffect, useState } from 'react';
import {
  type DueReviewCard,
  type ReviewPreviewResponse,
  type ReviewRating,
  type ReviewStatsResponse,
  type VocabularyItem,
} from '@voice-chat/shared';
import { AppIcon } from '../../../components/app-icon.js';

export interface FlashcardReviewPanelProps {
  items: (VocabularyItem | DueReviewCard)[];
  onGrade: (
    cardIdOrWordId: string,
    rating: ReviewRating,
    eventId: string,
    expectedVersion: number,
  ) => Promise<void>;
  onPreview?: (cardIdOrWordId: string) => Promise<ReviewPreviewResponse | null>;
  enabled?: boolean;
  stats?: ReviewStatsResponse | null;
}

function formatIntervalBadge(nextDueAt?: string, now = Date.now()): string | null {
  if (!nextDueAt) return null;
  const minutes = Math.max(1, Math.round((Date.parse(nextDueAt) - now) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  const days = Math.round(minutes / 1440);
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

export function FlashcardReviewPanel({
  items,
  onGrade,
  onPreview,
  enabled = true,
  stats,
}: FlashcardReviewPanelProps) {
  const [revealedWordId, setRevealedWordId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<ReviewPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [reviewedTodayCount, setReviewedTodayCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    wordId: string;
    rating: ReviewRating;
    eventId: string;
    version: number;
  } | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const activeItems = items.filter(
    (it) => (!('deleted_at' in it) || it.deleted_at === '') && it.review_state !== 'suspended',
  );
  const dueCards = activeItems.filter((it) => {
    const ms = Date.parse(it.due_at);
    return !Number.isFinite(ms) || ms <= nowMs;
  });

  const currentCard = dueCards[0] ?? null;
  const targetId = currentCard
    ? (('card_id' in currentCard ? currentCard.card_id : undefined) ?? currentCard.word_id)
    : null;
  const version = currentCard
    ? (('row_version' in currentCard ? currentCard.row_version : undefined) ?? currentCard.version)
    : 1;
  const isRevealed = currentCard !== null && revealedWordId === targetId;
  const reverse = currentCard && 'card_type' in currentCard && currentCard.card_type === 'vi_to_en';

  useEffect(() => {
    let cancelled = false;
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
    if (isRevealed && targetId && onPreview) {
      setPreviewLoading(true);
      void onPreview(targetId)
        .then((res) => {
          if (!cancelled) {
            if (
              !res ||
              res.card_id !== targetId ||
              (res.row_version !== undefined && res.row_version !== version)
            )
              throw new Error('Thẻ đã thay đổi. Hãy tải lại dữ liệu trước khi ôn.');
            setPreviewData(res);
          }
        })
        .catch((failure) => {
          if (!cancelled)
            setPreviewError(failure instanceof Error ? failure.message : 'Không thể xem lịch ôn.');
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [isRevealed, targetId, version, onPreview, previewAttempt]);

  const handleGrade = async (rating: ReviewRating) => {
    if ((!currentCard && !pending) || busy || !enabled) {
      return;
    }
    const operation = pending ?? {
      wordId: targetId!,
      rating,
      eventId: crypto.randomUUID(),
      version,
    };
    setPending(operation);
    setBusy(true);
    setError(null);
    try {
      await onGrade(operation.wordId, operation.rating, operation.eventId, operation.version);
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
          <span className="stat-label">
            <AppIcon name="review" size={18} /> Tổng số thẻ
          </span>
          <strong className="stat-value">{stats?.total_active_cards ?? activeItems.length}</strong>
        </div>
        <div className="stat-card" data-testid="stat-due-words">
          <span className="stat-label">
            <AppIcon name="clock" size={18} /> Cần ôn trong ngày
          </span>
          <strong className="stat-value">{stats?.due_today ?? dueCards.length}</strong>
        </div>
        <div className="stat-card" data-testid="stat-reviewed-today">
          <span className="stat-label">
            <AppIcon name="good" size={18} /> {stats ? 'Đã ôn hôm nay' : 'Đã ôn phiên này'}
          </span>
          <strong className="stat-value">{stats?.completed_today ?? reviewedTodayCount}</strong>
        </div>
      </div>

      {error && (
        <div className="voice-clarify-banner" role="status" data-testid="offline-review-banner">
          {error} Chưa xác nhận lưu kết quả. Nhấn lại mức đánh giá để thử cùng sự kiện.
          {pending && (
            <button
              type="button"
              className="btn-warning"
              disabled={busy}
              onClick={() => void handleGrade(pending.rating)}
            >
              <AppIcon name="again" size={18} /> Thử gửi lại kết quả
            </button>
          )}
        </div>
      )}

      {!currentCard ? (
        <div className="flashcard-empty" data-testid="flashcard-empty-state">
          <h2>
            <AppIcon name="good" size={25} /> Bạn đã hoàn thành toàn bộ thẻ ôn tập đến hạn!
          </h2>
          <p>
            Hệ thống sẽ nhắc bạn vào 08:00 sáng (giờ Việt Nam) trên Telegram khi có từ đến hạn mới.
          </p>
        </div>
      ) : (
        <div className="flashcard-box" data-testid="flashcard-active">
          <div className="flashcard-front">
            <span className="flashcard-pos">{currentCard.part_of_speech}</span>
            <h2 className="flashcard-word" data-testid="flashcard-word">
              {reverse ? currentCard.meaning_vi : currentCard.word}
            </h2>
            {currentCard.source_excerpt && (
              <p className="flashcard-context">“{currentCard.source_excerpt}”</p>
            )}
          </div>

          {!isRevealed ? (
            <button
              type="button"
              className="btn-primary btn-reveal"
              aria-label="Reveal flashcard meaning and example"
              onClick={() => setRevealedWordId(targetId)}
              disabled={busy || !enabled}
              data-testid="btn-reveal-answer"
            >
              <AppIcon name="eye" size={19} /> Show Answer
            </button>
          ) : (
            <div className="flashcard-back" data-testid="flashcard-back">
              <p className="flashcard-meaning">
                <strong>{reverse ? 'Tiếng Anh:' : 'Nghĩa:'}</strong>{' '}
                {reverse ? currentCard.word : currentCard.meaning_vi}
              </p>
              {currentCard.example && (
                <p className="flashcard-example">
                  <strong>Ví dụ:</strong> {currentCard.example}
                </p>
              )}

              <div className="srs-buttons" role="group" aria-label="Rate memory recall">
                {previewLoading && <p role="status">Đang xem lịch ôn...</p>}
                {previewError && (
                  <div
                    className="review-preview-error"
                    role="alert"
                    data-testid="review-preview-error"
                  >
                    <p>{previewError}</p>
                    <button
                      type="button"
                      className="btn-secondary btn-outline-info"
                      disabled={!enabled || previewLoading}
                      onClick={() => {
                        setPreviewData(null);
                        setPreviewError(null);
                        setPreviewAttempt((attempt) => attempt + 1);
                      }}
                      data-testid="btn-retry-review-preview"
                    >
                      <AppIcon name="again" size={18} /> Thử tải lịch lại
                    </button>
                  </div>
                )}
                {[
                  {
                    rating: 'again' as const,
                    defaultLabel: 'Again',
                    badge: formatIntervalBadge(previewData?.preview.again?.next_due_at),
                  },
                  {
                    rating: 'hard' as const,
                    defaultLabel: 'Hard',
                    badge: formatIntervalBadge(previewData?.preview.hard?.next_due_at),
                  },
                  {
                    rating: 'good' as const,
                    defaultLabel: 'Good',
                    badge: formatIntervalBadge(previewData?.preview.good?.next_due_at),
                  },
                  {
                    rating: 'easy' as const,
                    defaultLabel: 'Easy',
                    badge: formatIntervalBadge(previewData?.preview.easy?.next_due_at),
                  },
                ].map((btn) => (
                  <button
                    key={btn.rating}
                    type="button"
                    className={`btn-rating btn-rating-${btn.rating}`}
                    aria-label={`Rate ${btn.rating}`}
                    onClick={() => handleGrade(btn.rating)}
                    disabled={
                      !enabled ||
                      busy ||
                      (pending !== null
                        ? pending.rating !== btn.rating || pending.wordId !== targetId
                        : previewLoading ||
                          previewError !== null ||
                          (onPreview !== undefined && previewData === null))
                    }
                    data-testid={`btn-rate-${btn.rating}`}
                  >
                    <AppIcon name={btn.rating} size={18} />
                    {btn.badge
                      ? `${btn.rating.charAt(0).toUpperCase() + btn.rating.slice(1)} (${btn.badge})`
                      : btn.defaultLabel}
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
