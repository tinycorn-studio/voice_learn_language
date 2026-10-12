import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LearningApiClient } from '../services/learning-api-client.js';
import { App } from './App.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows the failed request ID, adds an unauthenticated health result and copies the safe report', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true, clipboard: { writeText } });
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('private network detail'));
  const api = new LearningApiClient('https://worker.example', () => 'private-init', fetchFn);
  render(<App api={api} />);
  await waitFor(() => expect(screen.getByText('NETWORK_ERROR')).toBeTruthy());
  expect(screen.getByText(api.diagnostics.getSnapshot()[0]!.request_id)).toBeTruthy();
  fireEvent.click(screen.getByText('Log chẩn đoán'));
  fetchFn.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ok: true,
        request_id: '12345678-1234-4123-8123-123456789abc',
        data: {
          status: 'healthy',
          service: 'voice-chat-worker',
          version: '0.1.0',
          timestamp: new Date().toISOString(),
        },
      }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  await waitFor(() =>
    expect(screen.getByText('Đã tới được máy chủ (/health). Hãy thử đăng nhập lại.')).toBeTruthy(),
  );
  expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('NETWORK_ERROR')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép log' }));
  await waitFor(() => expect(screen.getByText('Đã sao chép log.')).toBeTruthy());
  expect(writeText).toHaveBeenCalledWith(api.diagnostics.exportReport());
  expect(writeText.mock.calls[0]?.[0]).not.toContain('private');
  expect((screen.getByLabelText('Log chẩn đoán') as HTMLTextAreaElement).value).toContain(
    '/health',
  );
});

it.each(['missing', 'denied'])(
  'allows manual copying when the clipboard is %s on iOS',
  async (mode) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'navigator',
      mode === 'missing'
        ? {}
        : { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } },
    );
    const api = new LearningApiClient('https://worker.example', () => '', vi.fn<typeof fetch>());
    render(<App api={api} />);
    await waitFor(() => expect(screen.getByText('MISSING_INIT_DATA')).toBeTruthy());
    fireEvent.click(screen.getByText('Log chẩn đoán'));
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép log' }));
    await waitFor(() => expect(screen.getByText(/Không thể sao chép tự động/)).toBeTruthy());
    const textarea = screen.getByLabelText('Log chẩn đoán') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    fireEvent.focus(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  },
);
