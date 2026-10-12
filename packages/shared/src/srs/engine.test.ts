import { describe, expect, it } from 'vitest';
import {
  calculateNextReview,
  exportVocabularyToCsv,
  formatLocalDateAsiaHoChiMinh,
  importVocabularyFromCsv,
  type SrsCardState,
  type VocabularyItem,
} from '../index.js';

describe('M4-01 Deterministic Spaced Repetition Engine (docs/16_SRS.md 8 Test Vectors)', () => {
  const nowIso = '2026-10-12T01:00:00.000Z';
  const newCard: SrsCardState = {
    reviewState: 'new',
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: nowIso,
  };

  it('Vector 1: New + good -> due 24h (1 day) after now, repetitions=1, ease=2.5', () => {
    const res = calculateNextReview(newCard, 'good', nowIso);
    expect(res.reviewState).toBe('review');
    expect(res.repetitions).toBe(1);
    expect(res.intervalDays).toBe(1);
    expect(res.easeFactor).toBe(2.5);
    expect(res.dueAt).toBe('2026-10-13T01:00:00.000Z');
  });

  it('Vector 2: New + easy -> due 96h (4 days) after now, repetitions=1, ease=2.65', () => {
    const res = calculateNextReview(newCard, 'easy', nowIso);
    expect(res.reviewState).toBe('review');
    expect(res.repetitions).toBe(1);
    expect(res.intervalDays).toBe(4);
    expect(res.easeFactor).toBe(2.65);
    expect(res.dueAt).toBe('2026-10-16T01:00:00.000Z');
  });

  it('Vector 3: New + again -> due 10m after now, repetitions=0, ease=2.3, state=learning', () => {
    const res = calculateNextReview(newCard, 'again', nowIso);
    expect(res.reviewState).toBe('learning');
    expect(res.repetitions).toBe(0);
    expect(res.intervalDays).toBe(0);
    expect(res.easeFactor).toBe(2.3);
    expect(res.dueAt).toBe('2026-10-12T01:10:00.000Z');
  });

  it('Vector 4: 3rd good with ease=2.5 and old interval=3d -> 8d (ceil(3 * 2.5 = 7.5))', () => {
    const firstGood = calculateNextReview(newCard, 'good', nowIso);
    expect(firstGood.intervalDays).toBe(1);

    const secondGood = calculateNextReview(firstGood, 'good', firstGood.dueAt);
    expect(secondGood.intervalDays).toBe(3);
    expect(secondGood.repetitions).toBe(2);

    const thirdGood = calculateNextReview(secondGood, 'good', secondGood.dueAt);
    expect(thirdGood.intervalDays).toBe(8);
    expect(thirdGood.repetitions).toBe(3);
    expect(thirdGood.easeFactor).toBe(2.5);
  });

  it('Vector 5: Hard never produces past due date and ease never drops below 1.3', () => {
    let card: SrsCardState = {
      reviewState: 'review',
      repetitions: 2,
      intervalDays: 2,
      easeFactor: 1.35,
      dueAt: nowIso,
    };
    card = calculateNextReview(card, 'hard', nowIso);
    expect(card.easeFactor).toBe(1.3);
    expect(Date.parse(card.dueAt)).toBeGreaterThan(Date.parse(nowIso));

    const againFloor = calculateNextReview(card, 'again', card.dueAt);
    expect(againFloor.easeFactor).toBe(1.3);
  });

  it('Vector 6: Review at 23:59 VN (16:59 UTC) rolls over UTC and Vietnam local date accurately (TC-13)', () => {
    const lateVnIso = '2026-10-12T16:59:00.000Z'; // 2026-10-12 23:59 +07:00
    expect(formatLocalDateAsiaHoChiMinh(lateVnIso)).toBe('2026-10-12');

    const againRes = calculateNextReview(newCard, 'again', lateVnIso);
    // +10 minutes -> 2026-10-12T17:09:00.000Z -> 2026-10-13 00:09 +07:00
    expect(againRes.dueAt).toBe('2026-10-12T17:09:00.000Z');
    expect(formatLocalDateAsiaHoChiMinh(againRes.dueAt)).toBe('2026-10-13');
  });

  it('M3-04: CSV export and import roundtrip preserves vocabulary fields and escapes formulas', () => {
    const sampleItems: VocabularyItem[] = [
      {
        word_id: 'w_001',
        user_id: 'telegram:777888999',
        word_key: 'telegram:777888999|overwhelmed|adjective|feeling_unable_to_cope',
        word: 'overwhelmed',
        lemma: 'overwhelmed',
        part_of_speech: 'adjective',
        sense_key: 'feeling_unable_to_cope',
        meaning_vi: 'quá tải, choáng ngợp',
        ipa: '/ˌəʊ.vəˈwelmd/',
        example: '=SUM(1,2) is a formula attempt, "quoted" text',
        source_excerpt: 'What does overwhelmed mean?',
        created_at: nowIso,
        last_asked_at: nowIso,
        times_asked: 2,
        review_state: 'review',
        repetitions: 1,
        interval_days: 1,
        ease_factor: 2.5,
        due_at: '2026-10-13T01:00:00.000Z',
        last_reviewed_at: nowIso,
        version: 2,
        deleted_at: '',
      },
    ];

    const csv = exportVocabularyToCsv(sampleItems);
    expect(csv).toContain("'=SUM(1,2)");

    const restored = importVocabularyFromCsv(csv);
    expect(restored).toEqual(sampleItems);
  });
});
