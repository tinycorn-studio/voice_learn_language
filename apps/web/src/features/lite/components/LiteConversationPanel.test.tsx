import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteConversationPanel } from './LiteConversationPanel.js';
import type { LiteSpeechRecognizer } from '../services/lite-speech.js';

function fakeRecognizer(): LiteSpeechRecognizer {
  return {
    lang: '',
    interimResults: false,
    continuous: false,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onresult: null,
    onerror: null,
    onend: null,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('M9-01 lite turn-based conversation panel', () => {
  it('sends one typed turn, passes bounded history, and speaks the tutor reply', async () => {
    const chatTurn = vi.fn(
      async (message: string, _history: Array<{ role: 'learner' | 'tutor'; text: string }>) =>
        `Reply to ${message}`,
    );
    const speak = vi.fn();
    render(
      <LiteConversationPanel
        enabled
        chatTurn={chatTurn}
        createRecognizer={() => null}
        speak={speak}
      />,
    );
    expect(screen.getByTestId('lite-mic-unsupported')).toBeTruthy();

    fireEvent.change(screen.getByTestId('lite-input'), { target: { value: 'Hello teacher!' } });
    fireEvent.click(screen.getByTestId('lite-send'));
    await waitFor(() => expect(screen.getAllByTestId('lite-turn-tutor')).toHaveLength(1));
    expect(screen.getByText('Hello teacher!')).toBeTruthy();
    expect(screen.getByText('Reply to Hello teacher!')).toBeTruthy();
    expect(chatTurn).toHaveBeenCalledWith('Hello teacher!', []);
    expect(speak).toHaveBeenCalledWith('Reply to Hello teacher!');
    expect((screen.getByTestId('lite-input') as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByTestId('lite-input'), { target: { value: 'I went to school.' } });
    fireEvent.click(screen.getByTestId('lite-send'));
    await waitFor(() => expect(chatTurn).toHaveBeenCalledTimes(2));
    expect(chatTurn.mock.calls[1]?.[1]).toEqual([
      { role: 'learner', text: 'Hello teacher!' },
      { role: 'tutor', text: 'Reply to Hello teacher!' },
    ]);
  });

  it('marks a failed turn, offers retry, and resends without duplicating the learner turn', async () => {
    const chatTurn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Gemini đang giới hạn lượt hội thoại nhẹ. Hãy chờ một chút rồi thử lại.'),
      )
      .mockResolvedValueOnce('Good try!');
    render(
      <LiteConversationPanel
        enabled
        chatTurn={chatTurn}
        createRecognizer={() => null}
        speak={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('lite-input'), { target: { value: 'I goed home.' } });
    fireEvent.click(screen.getByTestId('lite-send'));
    await waitFor(() => expect(screen.getByTestId('lite-error')).toBeTruthy());
    expect(screen.getByTestId('lite-error').textContent).toContain('giới hạn');
    expect(screen.getByTestId('lite-turn-learner').getAttribute('data-failed')).toBe('true');

    fireEvent.click(screen.getByTestId('lite-retry'));
    await waitFor(() => expect(screen.getByText('Good try!')).toBeTruthy());
    expect(chatTurn).toHaveBeenCalledTimes(2);
    expect(chatTurn.mock.calls[1]?.[1]).toEqual([]);
    expect(screen.getAllByTestId('lite-turn-learner')).toHaveLength(1);
    expect(screen.queryByTestId('lite-error')).toBeNull();
  });

  it('captures one spoken turn through the injected recognizer', async () => {
    const recognizer = fakeRecognizer();
    const chatTurn = vi.fn(async () => 'Nice!');
    render(
      <LiteConversationPanel
        enabled
        chatTurn={chatTurn}
        createRecognizer={() => recognizer}
        speak={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('lite-mic'));
    expect(recognizer.start).toHaveBeenCalledOnce();
    expect(screen.getByTestId('lite-mic').getAttribute('aria-pressed')).toBe('true');

    act(() => {
      recognizer.onresult?.({
        results: { length: 1, 0: { length: 1, 0: { transcript: 'I like apples.' } } },
      });
    });
    await waitFor(() => expect(chatTurn).toHaveBeenCalledWith('I like apples.', []));
    expect(chatTurn).toHaveBeenCalledOnce();
  });

  it('surfaces a clear message when microphone permission is denied', async () => {
    const recognizer = fakeRecognizer();
    render(
      <LiteConversationPanel
        enabled
        chatTurn={vi.fn()}
        createRecognizer={() => recognizer}
        speak={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('lite-mic'));
    act(() => {
      recognizer.onerror?.({ error: 'not-allowed' });
    });
    await waitFor(() =>
      expect(screen.getByTestId('lite-error').textContent).toContain('quyền micro'),
    );
  });
});
