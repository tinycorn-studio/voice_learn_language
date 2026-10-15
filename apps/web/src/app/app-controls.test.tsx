import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { LearningApiClient } from '../services/learning-api-client.js';
import type { GeminiLiveClientCallbacks } from '../features/voice/services/gemini-live-client.js';

function authenticatedApi() {
  const api = new LearningApiClient('https://synthetic.invalid', () => '');
  vi.spyOn(api, 'authenticate').mockResolvedValue({
    session_token: 'synthetic',
    user_id: 'telegram:123',
    expires_at: '2099-01-01T00:00:00.000Z',
  });
  return api;
}

afterEach(() => {
  cleanup();
  localStorage.removeItem('voice-chat.theme-preference');
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

it('persists a theme override, restores automatic mode, and opens an accessible Info dialog', async () => {
  const api = authenticatedApi();
  vi.spyOn(api, 'listVocabulary').mockResolvedValue([]);
  const view = render(<App api={api} />);
  await waitFor(() => expect(screen.queryByTestId('auth-loading')).toBeNull());

  const initialTheme = document.documentElement.dataset.theme;
  expect(initialTheme).toMatch(/^(light|dark)$/);
  fireEvent.click(screen.getByTestId('theme-toggle'));
  const chosenTheme = initialTheme === 'dark' ? 'light' : 'dark';
  expect(document.documentElement.dataset.theme).toBe(chosenTheme);
  expect(localStorage.getItem('voice-chat.theme-preference')).toBe(chosenTheme);

  view.unmount();
  render(<App api={api} />);
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe(chosenTheme));

  const infoButton = screen.getByTestId('info-button');
  fireEvent.click(infoButton);
  expect(screen.getByRole('dialog').textContent).toContain('Bấm Start Microphone');
  expect(document.activeElement).toBe(screen.getByTestId('info-close-button'));
  fireEvent.click(screen.getByTestId('theme-auto-button'));
  expect(localStorage.getItem('voice-chat.theme-preference')).toBe('auto');
  expect(document.documentElement.dataset.theme).toBe(initialTheme);

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(infoButton);
});

it('keeps a live voice session mounted while switching tabs and offers a return control', async () => {
  const api = authenticatedApi();
  vi.spyOn(api, 'listVocabulary').mockResolvedValue([]);
  let callbacks: GeminiLiveClientCallbacks | undefined;
  const stop = vi.fn();
  render(
    <App
      api={api}
      voiceFactory={(_mint, value) => {
        callbacks = value;
        return { start: async () => {}, stop, sendText: () => true };
      }}
    />,
  );
  await waitFor(() =>
    expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(false),
  );

  fireEvent.click(screen.getByTestId('btn-start-mic'));
  act(() => callbacks?.onStateChange('listening'));
  fireEvent.click(screen.getByTestId('tab-vocabulary'));

  expect(stop).not.toHaveBeenCalled();
  expect((screen.getByTestId('voice-tab-panel') as HTMLDivElement).hidden).toBe(true);
  await waitFor(() => expect(screen.getByTestId('vocab-list')).toBeTruthy());
  fireEvent.click(screen.getByTestId('voice-return-banner'));
  expect((screen.getByTestId('voice-tab-panel') as HTMLDivElement).hidden).toBe(false);
  expect(screen.getByTestId('voice-status-badge').getAttribute('data-state')).toBe('listening');
  expect(stop).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('btn-stop-mic'));
  expect(stop).toHaveBeenCalledOnce();
});
