import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LearningApiClient } from '../services/learning-api-client.js';
import { summarizeLatency } from '../services/api-diagnostics.js';
import { App } from './App.js';
import { ApiDiagnosticsPanel } from './ApiDiagnosticsPanel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('calculates bounded-session p50/p95 for odd/even/single samples and rejects invalid samples', () => {
  expect(summarizeLatency('test', [100, 0, 40, 20])).toEqual({
    metric: 'test',
    sample_count: 4,
    p50_ms: 30,
    p95_ms: 91,
  });
  expect(summarizeLatency('odd', [3, 1, 2])).toEqual({
    metric: 'odd',
    sample_count: 3,
    p50_ms: 2,
    p95_ms: 3,
  });
  expect(summarizeLatency('single', [5])).toEqual({
    metric: 'single',
    sample_count: 1,
    p50_ms: 5,
    p95_ms: 5,
  });
  expect(summarizeLatency('no-samples', [])).toBeNull();
  expect(summarizeLatency('empty', [Number.NaN, -1])).toBeNull();
});

it('exposes capture timings without HTTP errors and strips arbitrary private metadata', () => {
  const api = new LearningApiClient('https://worker.example', () => '');
  const metadata = {
    capture_id: '12345678-1234-4123-8123-123456789abc',
    stage: 'inquiry_detected' as const,
    reason: 'none' as const,
    path: 'direct' as const,
    elapsed_ms: 10,
    persistence_duration_ms: 7,
    question: 'private transcript',
    token: 'private token',
  };
  for (let index = 0; index < 105; index++) api.diagnostics.recordCapture(metadata);
  const startupMetadata = {
    stage: 'vocabulary_load_completed' as const,
    elapsed_ms: 300,
    duration_ms: 120,
    transcript: 'private transcript',
  };
  api.diagnostics.recordStartup(startupMetadata);
  api.diagnostics.record({
    request_id: 'web-1234567890abcdef12345678',
    server_request_id: null,
    method: 'POST',
    route: '/api/v1/vocabulary',
    code: 'OK',
    phase: 'complete',
    http_status: 200,
    duration_ms: 80,
    exception_name: null,
  });
  render(<ApiDiagnosticsPanel api={api} />);
  expect(screen.getByText('Log chẩn đoán')).toBeTruthy();
  const report = api.diagnostics.exportReport();
  expect(report).toContain('inquiry_detected');
  expect(report).toContain('persistence_duration_ms');
  expect(report).toContain('vocabulary_load_completed');
  expect(report).toContain('"p50_ms": 80');
  expect(report).toContain('"p95_ms": 80');
  expect(screen.getByLabelText('Độ trễ trong phiên hiện tại').textContent).toContain('80 ms');
  expect(report).not.toContain('transcript');
  expect(report).not.toContain('private');
  expect(api.diagnostics.getCaptureSnapshot()).toHaveLength(100);
  expect(screen.queryByText(/Mã lỗi gần nhất/)).toBeNull();
});

it('bounds startup diagnostics and rejects unknown startup stages', () => {
  const api = new LearningApiClient('https://worker.example', () => '');
  for (let index = 0; index < 35; index++)
    api.diagnostics.recordStartup({ stage: 'voice_ready', elapsed_ms: index });
  api.diagnostics.recordStartup({ stage: 'private_stage', elapsed_ms: 1 } as never);
  expect(api.diagnostics.getStartupSnapshot()).toHaveLength(30);
  expect(api.diagnostics.getStartupSnapshot()[0]?.elapsed_ms).toBe(5);
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
  await waitFor(() => expect(screen.getByTestId('feedback-toast').textContent).toContain('Đã sao chép log'));
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
