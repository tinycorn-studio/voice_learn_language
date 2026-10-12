import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInitialFsrsCard,
  previewCardToResponse,
  type VocabularyItem,
} from '@voice-chat/shared';
import { FlashcardReviewPanel } from './FlashcardReviewPanel.js';
import { VocabularyManagerPanel } from '../../vocabulary/components/VocabularyManagerPanel.js';
import { VocabularySaveQueue } from '../../vocabulary/services/vocabulary-save-queue.js';

afterEach(() => {
  cleanup();
});

const SAMPLE_CARD: VocabularyItem = {
  word_id: 'w_card_1',
  user_id: 'telegram:777',
  word_key: 'telegram:777|resilient|adjective|able_to_recover',
  word: 'resilient',
  lemma: 'resilient',
  part_of_speech: 'adjective',
  sense_key: 'able_to_recover',
  meaning_vi: 'kiên cường, phục hồi nhanh',
  ipa: '',
  example: 'Children are often very resilient.',
  source_excerpt: 'What does resilient mean?',
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
};

describe('M4-04 & M3-04 FlashcardReviewPanel, VocabularyManagerPanel & SaveQueue', () => {
  it('shows native 1m/10m steps and submits Card version independently from Word version', async () => {
    const now = new Date().toISOString();
    const card = {
      ...createInitialFsrsCard({
        cardId: 'c_independent',
        userId: SAMPLE_CARD.user_id,
        wordId: SAMPLE_CARD.word_id,
        nowIso: now,
      }),
      row_version: 4,
    };
    const onGrade = vi.fn().mockResolvedValue(undefined);
    const onPreview = vi.fn().mockResolvedValue(previewCardToResponse(card, now));
    render(
      <FlashcardReviewPanel
        items={[{ ...SAMPLE_CARD, card_id: card.card_id, row_version: 4, version: 99 }]}
        onGrade={onGrade}
        onPreview={onPreview}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-reveal-answer'));
    await waitFor(() =>
      expect(screen.getByTestId('btn-rate-again').textContent).toBe('Again (1m)'),
    );
    expect(screen.getByTestId('btn-rate-good').textContent).toBe('Good (10m)');
    fireEvent.click(screen.getByTestId('btn-rate-good'));
    await waitFor(() =>
      expect(onGrade).toHaveBeenCalledWith(card.card_id, 'good', expect.any(String), 4),
    );
  });
  it('shows preview errors and disables grading until a trustworthy preview is available', async () => {
    const onGrade = vi.fn();
    render(
      <FlashcardReviewPanel
        items={[SAMPLE_CARD]}
        onGrade={onGrade}
        onPreview={vi.fn().mockRejectedValue(new Error('synthetic preview unavailable'))}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-reveal-answer'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('preview unavailable'),
    );
    expect((screen.getByTestId('btn-rate-good') as HTMLButtonElement).disabled).toBe(true);
    expect(onGrade).not.toHaveBeenCalled();
  });
  it('conceals answer and only counts a grade after backend confirmation', async () => {
    const onGrade = vi.fn().mockResolvedValue(undefined);
    render(<FlashcardReviewPanel items={[SAMPLE_CARD]} onGrade={onGrade} />);

    expect(screen.getByTestId('flashcard-word').textContent).toBe('resilient');
    expect(screen.queryByTestId('flashcard-back')).toBeNull();

    fireEvent.click(screen.getByTestId('btn-reveal-answer'));
    expect(screen.getByTestId('flashcard-back').textContent).toContain('kiên cường');

    fireEvent.click(screen.getByTestId('btn-rate-good'));
    expect(onGrade).toHaveBeenCalledWith(SAMPLE_CARD.word_id, 'good', expect.any(String), 1);
    await waitFor(() =>
      expect(screen.getByTestId('stat-reviewed-today').textContent).toContain('1'),
    );
  });

  it('supports editing meaning without resetting SRS progress and exporting CSV in VocabularyManagerPanel', async () => {
    const updates: VocabularyItem[] = [];
    render(
      <VocabularyManagerPanel
        items={[{ ...SAMPLE_CARD, repetitions: 3, interval_days: 8 }]}
        onUpdateItem={async (item, changes) => {
          updates.push({ ...item, ...changes });
        }}
        onDeleteItem={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByTestId('btn-edit-w_card_1'));
    const meaningInput = screen.getByTestId('edit-meaning-input') as HTMLInputElement;
    fireEvent.change(meaningInput, { target: { value: 'bền bỉ, kiên cường' } });
    fireEvent.click(screen.getByTestId('btn-save-edit'));

    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]?.meaning_vi).toBe('bền bỉ, kiên cường');
    // SRS progress preserved on manual edit (`docs/16_SRS.md` invariant)
    expect(updates[0]?.repetitions).toBe(3);
    expect(updates[0]?.interval_days).toBe(8);

    fireEvent.click(screen.getByTestId('btn-export-csv'));
    const csvOutput = screen.getByTestId('csv-export-output') as HTMLTextAreaElement;
    expect(csvOutput.value).toContain('word_id,user_id,word_key');
    expect(csvOutput.value).toContain('resilient');
  });

  it('never marks saved prematurely on GAS timeout and reuses event_id on retry (TC-14)', async () => {
    const persistMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, errorMessage: 'GAS timeout' })
      .mockResolvedValueOnce({
        ok: true as const,
        data: { word_id: 'w_999', created: true, duplicate_event: false },
      });

    const queue = new VocabularySaveQueue(persistMock);
    const req = {
      event_id: '9e99f3c2-92a8-4bcc-b3fa-f03c9ce2c4b9',
      word: 'overwhelmed',
      part_of_speech: 'adjective' as const,
      sense_key: 'default',
      meaning_vi: 'quá tải',
      example: '',
      source_excerpt: 'What does overwhelmed mean?',
    };

    const firstAttempt = await queue.enqueueAndAttempt(req);
    expect(firstAttempt.status).toBe('pending');
    expect(firstAttempt.wordId).toBeNull();

    const retried = await queue.retryPending();
    expect(retried[0]?.status).toBe('saved');
    expect(retried[0]?.wordId).toBe('w_999');
    expect(persistMock).toHaveBeenCalledTimes(2);
    expect(persistMock.mock.calls[0]?.[0].event_id).toBe(req.event_id);
    expect(persistMock.mock.calls[1]?.[0].event_id).toBe(req.event_id);
  });
});
