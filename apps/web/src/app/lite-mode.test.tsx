import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { LearningApiClient } from '../services/learning-api-client.js';

function authenticatedApi() {
  const api = new LearningApiClient('https://synthetic.invalid', () => '');
  vi.spyOn(api, 'authenticate').mockResolvedValue({
    session_token: 'synthetic',
    user_id: 'telegram:123',
    expires_at: '2099-01-01T00:00:00.000Z',
  });
  return api;
}

const storageMap = new Map<string, string>();
const storageMock: Storage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, String(value));
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
  key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
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
  vi.restoreAllMocks();
});

it('switches to lite mode, remembers the choice, and chats without minting a live token', async () => {
  const api = authenticatedApi();
  vi.spyOn(api, 'listVocabulary').mockResolvedValue([]);
  const mintLiveToken = vi.spyOn(api, 'mintLiveToken');
  const chatTurn = vi.spyOn(api, 'chatTurn').mockResolvedValue('That sounds great!');
  render(<App api={api} />);
  await waitFor(() => expect(screen.queryByTestId('auth-loading')).toBeNull());
  expect(screen.getByTestId('voice-mode-live').getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByTestId('voice-mode-lite'));
  expect(window.localStorage.getItem('voice-chat.voice-mode')).toBe('lite');
  const input = await screen.findByTestId('lite-input');
  expect(screen.getByTestId('lite-mic-unsupported')).toBeTruthy();
  fireEvent.change(input, { target: { value: 'Hello teacher!' } });
  fireEvent.click(screen.getByTestId('lite-send'));
  await waitFor(() => expect(screen.getByText('That sounds great!')).toBeTruthy());
  expect(chatTurn).toHaveBeenCalledWith('Hello teacher!', []);
  expect(mintLiveToken).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('voice-mode-live'));
  expect(window.localStorage.getItem('voice-chat.voice-mode')).toBe('live');
});

it('restores the remembered lite mode on the next open', async () => {
  window.localStorage.setItem('voice-chat.voice-mode', 'lite');
  const api = authenticatedApi();
  vi.spyOn(api, 'listVocabulary').mockResolvedValue([]);
  render(<App api={api} />);
  await waitFor(() => expect(screen.queryByTestId('auth-loading')).toBeNull());
  expect(screen.getByTestId('voice-mode-lite').getAttribute('aria-pressed')).toBe('true');
  await screen.findByTestId('lite-input');
});
