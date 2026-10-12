import { describe, expect, it } from 'vitest';
import {
  createInitialFsrsCard,
  previewFsrsCard,
  scheduleNextFsrsReview,
  toTsFsrsCard,
} from './fsrs-engine.js';

describe('FSRS ReviewScheduler Engine (ts-fsrs integration)', () => {
  const mockNow = '2026-10-12T08:00:00.000Z';

  it('initializes a fresh FSRS card using official createEmptyCard', () => {
    const card = createInitialFsrsCard({
      cardId: 'c_test_01',
      userId: 'telegram:123456',
      wordId: 'w_test_01',
      cardType: 'en_to_vi',
      nowIso: mockNow,
    });

    expect(card.card_id).toBe('c_test_01');
    expect(card.user_id).toBe('telegram:123456');
    expect(card.word_id).toBe('w_test_01');
    expect(card.card_type).toBe('en_to_vi');
    expect(card.state).toBe('New');
    expect(card.stability).toBe(0);
    expect(card.difficulty).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.row_version).toBe(1);
    expect(card.due_at_utc).toBe(mockNow);
    expect(card.last_review_at_utc).toBeNull();
  });

  it('previews outcomes for all 4 ratings without mutating original card', () => {
    const card = createInitialFsrsCard({
      cardId: 'c_test_02',
      userId: 'telegram:123456',
      wordId: 'w_test_02',
      nowIso: mockNow,
    });

    const preview = previewFsrsCard(card, mockNow);

    expect(preview).toHaveProperty('again');
    expect(preview).toHaveProperty('hard');
    expect(preview).toHaveProperty('good');
    expect(preview).toHaveProperty('easy');

    // Original card should remain untouched
    expect(card.reps).toBe(0);
    expect(card.row_version).toBe(1);

    // Check preview properties
    expect(Date.parse(preview.again.next_due_at)).toBeGreaterThan(Date.parse(mockNow));
    expect(Date.parse(preview.good.next_due_at)).toBeGreaterThan(Date.parse(mockNow));
    expect(preview.easy.stability).toBeGreaterThan(preview.again.stability);
  });

  it('applies "Good" rating to a new card and increments row_version', () => {
    const card = createInitialFsrsCard({
      cardId: 'c_test_03',
      userId: 'telegram:123456',
      wordId: 'w_test_03',
      nowIso: mockNow,
    });

    const result = scheduleNextFsrsReview(card, 'good', mockNow);

    expect(result.next_card.row_version).toBe(2);
    expect(result.next_card.reps).toBe(1);
    expect(result.next_card.lapses).toBe(0);
    expect(result.next_card.stability).toBeGreaterThan(0);
    expect(result.next_card.difficulty).toBeGreaterThan(0);
    expect(result.next_card.last_review_at_utc).toBe(mockNow);
    expect(Date.parse(result.next_card.due_at_utc)).toBeGreaterThan(Date.parse(mockNow));
    expect(result.review_log.rating).toBe(3); // Native ts-fsrs Grade, retained for audit/optimizer.
    expect(result.review_log_json).toContain('"rating":3');
    expect(JSON.parse(result.review_log_json)).toHaveProperty('learning_steps');
  });

  it('verifies "Hard" rating is NEVER treated as a failed recall', () => {
    // When learner rates Hard, lapses must NOT increase and stability must be non-zero
    const card = createInitialFsrsCard({
      cardId: 'c_test_04',
      userId: 'telegram:123456',
      wordId: 'w_test_04',
      nowIso: mockNow,
    });

    const result = scheduleNextFsrsReview(card, 'hard', mockNow);

    expect(result.next_card.lapses).toBe(0);
    expect(result.next_card.reps).toBe(1);
    expect(result.next_card.stability).toBeGreaterThan(0);
    expect(result.next_card.difficulty).toBeGreaterThan(0);
  });

  it('verifies "Again" rating on a review card increments lapses', () => {
    // Progress card to review state first
    const card = createInitialFsrsCard({
      cardId: 'c_test_05',
      userId: 'telegram:123456',
      wordId: 'w_test_05',
      nowIso: mockNow,
    });

    // 1st review: good (transitions New -> Learning)
    const step1 = scheduleNextFsrsReview(card, 'good', mockNow);
    // 2nd review: good (transitions Learning -> Review, graduates)
    const step2 = scheduleNextFsrsReview(step1.next_card, 'good', step1.next_card.due_at_utc);
    // 3rd review on mature card: good
    const step3 = scheduleNextFsrsReview(step2.next_card, 'good', step2.next_card.due_at_utc);

    expect(step3.next_card.state).toBe('Review');

    // Fail review: again (transitions Review -> Relearning, increments lapses)
    const failed = scheduleNextFsrsReview(step3.next_card, 'again', step3.next_card.due_at_utc);

    expect(failed.next_card.lapses).toBe(1);
    expect(failed.next_card.state).toBe('Relearning');
    expect(Date.parse(failed.next_card.due_at_utc)).toBeGreaterThan(
      Date.parse(step3.next_card.due_at_utc),
    );
  });

  it('supports independent cards for the same vocabulary item', () => {
    const cardEnToVi = createInitialFsrsCard({
      cardId: 'c_en_vi',
      userId: 'telegram:123456',
      wordId: 'w_apple',
      cardType: 'en_to_vi',
      nowIso: mockNow,
    });

    const cardViToEn = createInitialFsrsCard({
      cardId: 'c_vi_en',
      userId: 'telegram:123456',
      wordId: 'w_apple',
      cardType: 'vi_to_en',
      nowIso: mockNow,
    });

    // Review one card as Easy, other as Again
    const reviewEn = scheduleNextFsrsReview(cardEnToVi, 'easy', mockNow);
    const reviewVi = scheduleNextFsrsReview(cardViToEn, 'again', mockNow);

    expect(reviewEn.next_card.stability).toBeGreaterThan(reviewVi.next_card.stability);
    expect(reviewEn.next_card.card_type).toBe('en_to_vi');
    expect(reviewVi.next_card.card_type).toBe('vi_to_en');
    expect(reviewEn.next_card.word_id).toBe(reviewVi.next_card.word_id);
  });

  it('handles UTC timestamps across midnight boundary correctly', () => {
    const lateNightUtc = '2026-10-12T23:59:59.000Z';
    const card = createInitialFsrsCard({
      cardId: 'c_midnight',
      userId: 'telegram:123456',
      wordId: 'w_midnight',
      nowIso: lateNightUtc,
    });

    const result = scheduleNextFsrsReview(card, 'good', lateNightUtc);
    expect(result.next_card.due_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(result.next_card.due_at_utc)).toBeGreaterThan(Date.parse(lateNightUtc));
  });

  it('respects desired retention configuration', () => {
    const cardHigh = createInitialFsrsCard({
      cardId: 'c_high',
      userId: 'telegram:123456',
      wordId: 'w_retention',
      nowIso: mockNow,
    });
    const cardLow = createInitialFsrsCard({
      cardId: 'c_low',
      userId: 'telegram:123456',
      wordId: 'w_retention',
      nowIso: mockNow,
    });

    // High retention (0.95) requires shorter interval than low retention (0.80)
    const reviewHigh = scheduleNextFsrsReview(cardHigh, 'easy', mockNow, {
      request_retention: 0.95,
    });
    const reviewLow = scheduleNextFsrsReview(cardLow, 'easy', mockNow, { request_retention: 0.8 });

    // With lower retention requirement, the interval can be longer
    expect(Date.parse(reviewLow.next_card.due_at_utc)).toBeGreaterThanOrEqual(
      Date.parse(reviewHigh.next_card.due_at_utc),
    );
  });

  it('converts to ts-fsrs domain card with valid date objects', () => {
    const card = createInitialFsrsCard({
      cardId: 'c_domain',
      userId: 'telegram:123456',
      wordId: 'w_domain',
      nowIso: mockNow,
    });

    const tsCard = toTsFsrsCard(card);
    expect(tsCard.due).toBeInstanceOf(Date);
    expect(tsCard.due.toISOString()).toBe(mockNow);
    expect(tsCard.last_review).toBeUndefined();
  });
});
