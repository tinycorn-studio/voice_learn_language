import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { LearningApiClient } from '../services/learning-api-client.js';
import type { GeminiLiveClientCallbacks } from '../features/voice/services/gemini-live-client.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('acknowledges a durable save while the background vocabulary refresh is still pending', async () => {
  const api = new LearningApiClient('https://synthetic.invalid', () => '');
  vi.spyOn(api, 'authenticate').mockResolvedValue({
    session_token: 'synthetic',
    user_id: 'telegram:123',
    expires_at: '2099-01-01T00:00:00.000Z',
  });
  let release!: () => void;
  const list = vi
    .spyOn(api, 'listVocabulary')
    .mockResolvedValueOnce([])
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
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
  expect(list).toHaveBeenCalledTimes(2);
  expect(due).not.toHaveBeenCalled();
  expect(stats).not.toHaveBeenCalled();
  expect(screen.getByTestId('saved-word-badge').getAttribute('data-status')).toBe('saved');
  await act(async () => release());
});
