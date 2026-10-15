import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { LearningApiClient } from '../services/learning-api-client.js';
import type { VocabularyItem } from '@voice-chat/shared';
import type { GeminiLiveClientCallbacks } from '../features/voice/services/gemini-live-client.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('unlocks Voice after auth and loads Vocabulary only when its tab is opened', async () => {
  const api = new LearningApiClient('https://synthetic.invalid', () => '');
  vi.spyOn(api, 'authenticate').mockResolvedValue({
    session_token: 'synthetic',
    user_id: 'telegram:123',
    expires_at: '2099-01-01T00:00:00.000Z',
  });
  let releaseVocabulary!: (items: VocabularyItem[]) => void;
  const list = vi.spyOn(api, 'listVocabulary').mockImplementation(
    () => new Promise((resolve) => (releaseVocabulary = resolve)),
  );
  const due = vi.spyOn(api, 'listDueReviews');
  const stats = vi.spyOn(api, 'getReviewStats');
  vi.spyOn(api, 'createVocabulary').mockResolvedValue({
    word_id: 'synthetic',
    created: true,
    duplicate_event: false,
  });
  let callbacks: GeminiLiveClientCallbacks | undefined;
  render(
    <App
      api={api}
      voiceFactory={(_mint, value) => {
        callbacks = value;
        return { start: async () => {}, stop: () => {}, sendText: () => true };
      }}
    />,
  );

  await waitFor(() =>
    expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(false),
  );
  expect(list).not.toHaveBeenCalled();
  expect(due).not.toHaveBeenCalled();
  expect(stats).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('btn-start-mic'));
  let acknowledged = false;
  await act(async () => {
    const result = await callbacks!.onSaveVocabulary({
      event_id: 'synthetic-save-event',
      word: 'bank',
      lemma: 'bank',
      part_of_speech: 'noun',
      sense_key: 'default',
      meaning_vi: 'ngân hàng',
      example: '',
      source_excerpt: '',
    });
    acknowledged = result.ok;
  });
  expect(acknowledged).toBe(true);
  expect(list).not.toHaveBeenCalled();
  expect(screen.getByTestId('saved-word-badge').getAttribute('data-status')).toBe('saved');

  fireEvent.click(screen.getByTestId('tab-vocabulary'));
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByTestId('panel-loading').textContent).toContain('Đang tải'));
  await act(async () => releaseVocabulary([]));
  await waitFor(() => expect(screen.getByTestId('vocab-list')).toBeTruthy());
  expect(api.diagnostics.getStartupSnapshot().map((entry) => entry.stage)).toEqual(
    expect.arrayContaining([
      'auth_ready',
      'voice_ready',
      'vocabulary_load_started',
      'vocabulary_load_completed',
    ]),
  );
});
