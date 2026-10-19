import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { LearningApiClient } from '../services/learning-api-client.js';

const storageMap = new Map<string, string>();
const storageMock: Storage = {
  getItem: (key) => storageMap.get(key) ?? null,
  setItem: (key, value) => storageMap.set(key, String(value)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear(),
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size;
  },
};
Object.defineProperty(window, 'localStorage', {
  value: storageMock,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: storageMock,
  writable: true,
  configurable: true,
});

afterEach(() => {
  cleanup();
  storageMap.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

it('preserves the three bottom tabs and loads D1 due cards only when Active SRS is opened', async () => {
  const api = new LearningApiClient('https://synthetic.invalid', () => '');
  vi.spyOn(api, 'authenticate').mockResolvedValue({
    session_token: 'synthetic',
    user_id: 'telegram:123',
    expires_at: '2099-01-01T00:00:00.000Z',
  });
  const dueCards = vi.spyOn(api, 'listDueReviews').mockResolvedValue([
    {
      review_id: 'review-1',
      word_id: 'word-1',
      card_id: 'card-1',
      word: 'diligent',
      lemma: 'diligent',
      part_of_speech: 'adjective',
      meaning_vi: 'chăm chỉ',
      example: 'She is diligent.',
      source_excerpt: '',
      due_at: '2026-10-16T00:00:00.000Z',
      review_state: 'new',
      repetitions: 0,
      interval_days: 0,
      ease_factor: 2.5,
      version: 1,
      row_version: 1,
    },
  ]);
  render(<App api={api} />);
  await waitFor(() =>
    expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(false),
  );

  const navigation = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(
    Array.from(navigation.querySelectorAll('button')).map((button) => button.textContent?.trim()),
  ).toEqual(['Voice Tutor', 'Flashcards SRS', 'Vocabulary']);
  expect(screen.getByTestId('theme-toggle')).toBeTruthy();
  expect(screen.getByTestId('info-button')).toBeTruthy();
  expect(dueCards).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByTestId('btn-active-srs'));
  });
  await screen.findByText('1 thẻ đến hạn · đã chọn 1/3');
  expect(dueCards).toHaveBeenCalledOnce();
  expect((screen.getByRole('checkbox', { name: /diligent/i }) as HTMLInputElement).checked).toBe(
    true,
  );
});
