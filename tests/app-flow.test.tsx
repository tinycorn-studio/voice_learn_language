import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../apps/web/src/app/App.js';
import { LearningApiClient } from '../apps/web/src/services/learning-api-client.js';
import { createVoiceSession } from '../apps/web/src/features/voice/services/voice-session.js';
import { TestWebSocket } from '../apps/web/src/features/voice/services/test-websocket.js';
import { computeTelegramInitDataHash } from '../apps/worker/src/auth/telegram-auth.js';
import { handleWorkerRequest, SecurityStateStore } from '../apps/worker/src/entry.js';
import type { WorkerEnv } from '../apps/worker/src/domain/env.js';
import { createGasRuntimeHarness } from './gas-runtime-harness.js';

afterEach(cleanup);
describe('R01/R02 App -> Worker -> GAS with real client and synthetic audio/Gemini', () => {
  it.each(['original-tool', 'recovery-tool'] as const)(
    'authenticates, streams PCM, persists %s once despite lost response, edits/reviews/reloads/deletes',
    async (captureMode) => {
      const env: WorkerEnv = {
        GEMINI_API_KEY: 'synthetic-gemini',
        TELEGRAM_BOT_TOKEN: 'synthetic-bot',
        TELEGRAM_WEBHOOK_SECRET: 'synthetic-webhook',
        OWNER_TELEGRAM_ID: '123',
        GAS_SHARED_SECRET: 'synthetic-gas-secret',
        GAS_EXEC_URL: 'https://gas.example/exec',
      };
      const gas = createGasRuntimeHarness({
        SHEET_ID: 'synthetic',
        GAS_SHARED_SECRET: env.GAS_SHARED_SECRET,
        OWNER_USER_ID: 'telegram:123',
      });
      gas.setupSheets();
      const pairs = [
        ['auth_date', String(Math.floor(Date.now() / 1000))],
        ['user', JSON.stringify({ id: 123 })],
      ];
      const hash = await computeTelegramInitDataHash(
        pairs.map(([key, value]) => `${key}=${value}`).join('\n'),
        env.TELEGRAM_BOT_TOKEN,
      );
      const initData = new URLSearchParams([
        ...pairs.map((pair) => [pair[0]!, pair[1]!] as [string, string]),
        ['hash', hash],
      ]).toString();
      const upstream: typeof fetch = async (url, init) => {
        if (String(url) === env.GAS_EXEC_URL)
          return new Response(gas.doPost(String(init?.body)).bodyText, { status: 200 });
        return new Response(
          JSON.stringify({
            name: 'synthetic-ephemeral-token',
            expireTime: new Date(Date.now() + 1200000).toISOString(),
          }),
          { status: 200 },
        );
      };
      let dropFirstWriteResponse = true;
      let dropFirstReviewResponse = true;
      const store = new SecurityStateStore();
      const bridge: typeof fetch = async (url, init) => {
        // jsdom's browser AbortSignal is not an undici Request signal in this in-process bridge.
        const { signal: _browserSignal, ...requestInit } = init ?? {};
        const response = await handleWorkerRequest(
          new Request(String(url), requestInit),
          env,
          { fetchFn: upstream },
          store,
        );
        if (
          dropFirstWriteResponse &&
          String(url).endsWith('/api/v1/vocabulary') &&
          init?.method === 'POST'
        ) {
          dropFirstWriteResponse = false;
          throw new Error('lost response after commit');
        }
        if (dropFirstReviewResponse && String(url).endsWith('/api/v1/reviews/submit')) {
          dropFirstReviewResponse = false;
          throw new Error('lost review acknowledgement');
        }
        return response;
      };
      const makeApi = () => new LearningApiClient('https://worker.example', () => initData, bridge);
      const sockets: TestWebSocket[] = [];
      let pcm: ((data: string) => void) | undefined;
      let stopped = 0;
      const view = render(
        <App
          api={makeApi()}
          voiceFactory={(mint, callbacks) =>
            createVoiceSession(
              mint,
              callbacks,
              {
                start: async (callback) => {
                  pcm = callback;
                },
                stop: () => {
                  stopped++;
                },
                play: () => {},
                interrupt: () => {},
              },
              (url) => {
                const ws = new TestWebSocket(url);
                sockets.push(ws);
                return ws;
              },
            )
          }
        />,
      );
      await waitFor(() =>
        expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(false),
      );
      expect(screen.getByTestId('tab-vocabulary').textContent).toContain('(0)');
      fireEvent.click(screen.getByTestId('btn-start-mic'));
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => {
        sockets[0]!.onopen?.({});
        sockets[0]!.emit({ setupComplete: {} });
      });
      await waitFor(() =>
        expect(screen.getByTestId('voice-status-badge').getAttribute('data-state')).toBe(
          'listening',
        ),
      );
      pcm?.('AAAA');
      expect(sockets[0]!.sent.at(-1)).toContain('audio/pcm;rate=16000');
      act(() => {
        sockets[0]!.emit({
          serverContent: { inputTranscription: { text: 'What does bank mean?', finished: true } },
        });
        if (captureMode === 'recovery-tool')
          sockets[0]!.emit({
            serverContent: {
              outputTranscription: { text: 'Bank có nghĩa là ngân hàng.' },
              turnComplete: true,
            },
          });
      });
      if (captureMode === 'recovery-tool') {
        await waitFor(
          () =>
            expect(sockets[0]!.sent.some((frame) => frame.includes('clientContent'))).toBe(true),
          { timeout: 4000 },
        );
        expect(gas.spreadsheet.getSheetByName('Words')?.getLastRow()).toBe(1);
      }
      act(() => {
        sockets[0]!.emit({
          toolCall: {
            functionCalls: [
              {
                id: 'call-bank-1',
                name: 'save_vocabulary',
                args: {
                  word: 'bank',
                  meaning_vi: 'ngân hàng',
                  source_excerpt: 'What does bank mean?',
                },
              },
            ],
          },
        });
      });
      await waitFor(() =>
        expect(screen.getByTestId('saved-word-badge').textContent).toContain('Không thể kết nối'),
      );
      expect(screen.getByTestId('saved-word-badge').getAttribute('data-status')).toBe('pending');
      expect(gas.spreadsheet.getSheetByName('Words')?.getLastRow()).toBe(2);
      fireEvent.click(screen.getByText('Thử đồng bộ lại'));
      await waitFor(() =>
        expect(screen.getByTestId('saved-word-badge').getAttribute('data-status')).toBe('saved'),
      );
      await waitFor(() =>
        expect(screen.getByTestId('tab-vocabulary').textContent).toContain('(1)'),
      );
      expect(gas.spreadsheet.getSheetByName('Words')?.getLastRow()).toBe(2);
      expect(gas.spreadsheet.getSheetByName('Events')?.getLastRow()).toBe(2);
      expect(gas.spreadsheet.getSheetByName('Cards')?.getLastRow()).toBe(2);
      fireEvent.click(screen.getByTestId('tab-vocabulary'));
      expect(stopped).toBeGreaterThan(0);
      fireEvent.click(screen.getByText('Edit'));
      fireEvent.change(screen.getByTestId('edit-meaning-input'), {
        target: { value: 'ngân hàng thương mại' },
      });
      fireEvent.click(screen.getByTestId('btn-save-edit'));
      await waitFor(() => expect(screen.queryByTestId('edit-meaning-input')).toBeNull());
      expect(screen.getByTestId('vocab-list').textContent).toContain('ngân hàng thương mại');
      const cardsSheet = gas.spreadsheet.getSheetByName('Cards')!;
      const reverseCard = [...cardsSheet.rows[1]!];
      reverseCard[cardsSheet.rows[0]!.indexOf('card_id')] = 'c_reverse_bank';
      reverseCard[cardsSheet.rows[0]!.indexOf('card_type')] = 'vi_to_en';
      cardsSheet.appendRow(reverseCard);
      fireEvent.click(screen.getByTestId('tab-review'));
      await waitFor(() =>
        expect(screen.getByTestId('stat-due-words').querySelector('strong')?.textContent).toBe('2'),
      );
      fireEvent.click(screen.getByTestId('btn-reveal-answer'));
      await waitFor(() =>
        expect((screen.getByTestId('btn-rate-good') as HTMLButtonElement).disabled).toBe(false),
      );
      fireEvent.click(screen.getByTestId('btn-rate-good'));
      await waitFor(() =>
        expect(screen.getByTestId('offline-review-banner').textContent).toContain('Chưa xác nhận'),
      );
      fireEvent.click(screen.getByTestId('btn-rate-good'));
      await waitFor(() =>
        expect(screen.getByTestId('flashcard-word').textContent).toBe('ngân hàng thương mại'),
      );
      expect(cardsSheet.rows[1]![cardsSheet.rows[0]!.indexOf('reps')]).toBe(1);
      expect(cardsSheet.rows[2]![cardsSheet.rows[0]!.indexOf('reps')]).toBe(0);
      expect(gas.spreadsheet.getSheetByName('Reviews')?.getLastRow()).toBe(2);
      // The next card may render while the previous ACK/refresh is still pending.
      await waitFor(() =>
        expect((screen.getByTestId('btn-reveal-answer') as HTMLButtonElement).disabled).toBe(false),
      );
      fireEvent.click(screen.getByTestId('btn-reveal-answer'));
      await waitFor(() =>
        expect((screen.getByTestId('btn-rate-easy') as HTMLButtonElement).disabled).toBe(false),
      );
      fireEvent.click(screen.getByTestId('btn-rate-easy'));
      await waitFor(() => expect(screen.queryByTestId('flashcard-active')).toBeNull());
      expect(gas.spreadsheet.getSheetByName('Reviews')?.getLastRow()).toBe(3);
      view.unmount();
      render(<App api={makeApi()} />);
      await waitFor(() =>
        expect(screen.getByTestId('tab-vocabulary').textContent).toContain('(1)'),
      );
      fireEvent.click(screen.getByTestId('tab-vocabulary'));
      expect(screen.getByTestId('vocab-list').textContent).toContain('ngân hàng thương mại');
      fireEvent.click(screen.getByText('Delete'));
      await waitFor(() =>
        expect(screen.getByTestId('tab-vocabulary').textContent).toContain('(0)'),
      );
    },
    15000,
  );

  it('rejects standalone unauthenticated access without showing sample words or opening microphone', async () => {
    render(<App api={new LearningApiClient('https://worker.example', () => '')} />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Telegram Mini App'),
    );
    expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('tab-vocabulary').textContent).toContain('(0)');
  });

  it('retries authentication after a network failure without reopening the Mini App', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const api = new LearningApiClient('https://worker.example', () => 'signed-init-data', fetchFn);
    render(<App api={api} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('kết nối máy chủ'));
    expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(true);
    fetchFn.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            ok: true,
            data: String(url).endsWith('/auth/telegram')
              ? {
                  session_token: 'synthetic-session',
                  expires_at: new Date(Date.now() + 3600000).toISOString(),
                  user_id: 'telegram:123',
                }
              : String(url).endsWith('/reviews/stats')
                ? {
                    due_today: 0,
                    completed_today: 0,
                    new_cards: 0,
                    learning_cards: 0,
                    review_cards: 0,
                    relearning_cards: 0,
                    total_active_cards: 0,
                    total_reviews_count: 0,
                  }
                : { items: [], next_cursor: null },
            request_id: 'test-request',
          }),
        ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thử kết nối lại' }));
    await waitFor(() =>
      expect((screen.getByTestId('btn-start-mic') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });
});
