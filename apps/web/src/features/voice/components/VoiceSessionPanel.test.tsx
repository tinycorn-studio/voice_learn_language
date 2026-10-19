import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DueReviewCard } from '@voice-chat/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSessionPanel, type VoiceSessionFactory } from './VoiceSessionPanel.js';
import {
  AudioSessionController,
  downsampleFloat32ToInt16Pcm,
} from '../services/audio-session-controller.js';

function createDueCard(index: number): DueReviewCard {
  return {
    review_id: `review-${index}`,
    word_id: `word-${index}`,
    card_id: `card-${index}`,
    word: ['diligent', 'overwhelmed', 'scissors', 'reliable'][index - 1] ?? `word${index}`,
    lemma: ['diligent', 'overwhelmed', 'scissors', 'reliable'][index - 1] ?? `word${index}`,
    part_of_speech: 'adjective',
    meaning_vi: `nghĩa ${index}`,
    example: '',
    source_excerpt: '',
    due_at: '2026-10-16T00:00:00.000Z',
    review_state: 'new',
    repetitions: 0,
    interval_days: 0,
    ease_factor: 2.5,
    version: 1,
    row_version: 1,
  };
}

afterEach(cleanup);
describe('Voice session UI and microphone cancellation', () => {
  it('starts the session from user gesture and reflects real callbacks, then stops on unmount', () => {
    let callbacks: Parameters<VoiceSessionFactory>[0] | undefined;
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn();
    const sendText = vi.fn().mockReturnValue(true);
    const view = render(
      <VoiceSessionPanel
        sessionFactory={(value) => {
          callbacks = value;
          return { start, stop, sendText };
        }}
        translateText={vi.fn().mockResolvedValue('Bản dịch.')}
      />,
    );
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('btn-start-mic'));
    expect(start).toHaveBeenCalledTimes(1);
    for (const state of [
      'listening',
      'thinking',
      'speaking',
      'reconnecting',
      'error',
      'idle',
    ] as const) {
      act(() => callbacks?.onStateChange(state));
      expect(screen.getByTestId('voice-status-badge').getAttribute('data-state')).toBe(state);
    }
    act(() => {
      callbacks?.onStateChange('listening');
      callbacks?.onTranscript('assistant', 'Hello learner.', true);
    });
    expect(screen.getByTestId('transcript-box').textContent).toContain('Hello learner.');
    fireEvent.change(screen.getByTestId('utterance-input'), {
      target: { value: 'What does bank mean?' },
    });
    fireEvent.click(screen.getByTestId('btn-send-utterance'));
    expect(sendText).toHaveBeenCalledWith('What does bank mean?');
    expect(screen.queryByTestId('saved-word-badge')).toBeNull();
    fireEvent.click(screen.getByTestId('btn-stop-mic'));
    expect(stop).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it('cannot open microphone before authentication', () => {
    const factory = vi.fn();
    render(
      <VoiceSessionPanel
        sessionFactory={factory}
        translateText={vi.fn().mockResolvedValue('Bản dịch.')}
        enabled={false}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-start-mic'));
    expect(factory).not.toHaveBeenCalled();
  });
  it('closes tracks that arrive after Stop while permission prompt was pending', async () => {
    const track = { kind: 'audio', readyState: 'live', stop: vi.fn() };
    let resolve:
      | ((stream: {
          getTracks: () => (typeof track)[];
          getAudioTracks: () => (typeof track)[];
        }) => void)
      | undefined;
    const controller = new AudioSessionController({
      getUserMedia: () =>
        new Promise((value) => {
          resolve = value;
        }),
    });
    const pending = controller.requestMicrophone();
    controller.stop();
    resolve?.({ getTracks: () => [track], getAudioTracks: () => [track] });
    expect((await pending).ok).toBe(false);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(controller.isStreaming()).toBe(false);
  });
  it('maps denied permissions and correctly downsamples native PCM', async () => {
    const controller = new AudioSessionController({
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    });
    expect((await controller.requestMicrophone()).permission).toBe('denied');
    const samples = new Float32Array(480).fill(0.5);
    const pcm = downsampleFloat32ToInt16Pcm(samples, 48000);
    expect(pcm).toHaveLength(160);
    expect(pcm[0]).toBe(16383);
  });

  it('follows incoming transcript until the learner scrolls up, then returns on demand', async () => {
    let callbacks: Parameters<VoiceSessionFactory>[0] | undefined;
    render(
      <VoiceSessionPanel
        sessionFactory={(value) => {
          callbacks = value;
          return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), sendText: vi.fn() };
        }}
        translateText={vi.fn().mockResolvedValue('Bản dịch.')}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-start-mic'));
    const box = screen.getByTestId('transcript-box');
    Object.defineProperties(box, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    act(() => callbacks?.onTranscript('assistant', 'First tutor response.', true));
    await act(
      async () =>
        await new Promise<void>((resolve) => {
          if (typeof window.requestAnimationFrame === 'function')
            window.requestAnimationFrame(() => resolve());
          else window.setTimeout(resolve, 0);
        }),
    );
    expect(box.scrollTop).toBe(300);
    expect(screen.queryByTestId('btn-transcript-latest')).toBeNull();

    box.scrollTop = 0;
    fireEvent.scroll(box);
    expect(screen.getByTestId('btn-transcript-latest')).toBeTruthy();
    act(() => callbacks?.onTranscript('user', 'Please explain that.', true));
    expect(box.scrollTop).toBe(0);

    fireEvent.click(screen.getByTestId('btn-transcript-latest'));
    expect(box.scrollTop).toBe(300);
    expect(screen.queryByTestId('btn-transcript-latest')).toBeNull();
  });

  it('translates a completed turn on demand and keeps the result cached for that turn', async () => {
    let callbacks: Parameters<VoiceSessionFactory>[0] | undefined;
    const translateText = vi
      .fn<(text: string) => Promise<string>>()
      .mockResolvedValue('Tôi cảm thấy quá tải.');
    render(
      <VoiceSessionPanel
        sessionFactory={(value) => {
          callbacks = value;
          return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), sendText: vi.fn() };
        }}
        translateText={translateText}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-start-mic'));
    act(() => callbacks?.onTranscript('assistant', 'I felt overwhelmed.', true));
    expect(translateText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('btn-translate-turn-1'));
    expect((await screen.findByTestId('translation-turn-1')).textContent).toContain(
      'Tôi cảm thấy quá tải.',
    );
    expect(translateText).toHaveBeenCalledOnce();
    expect(translateText).toHaveBeenCalledWith('I felt overwhelmed.');

    fireEvent.click(screen.getByTestId('btn-translate-turn-1'));
    expect(screen.queryByTestId('translation-turn-1')).toBeNull();
    fireEvent.click(screen.getByTestId('btn-translate-turn-1'));
    expect(screen.getByTestId('translation-turn-1').textContent).toContain('Tôi cảm thấy quá tải.');
    expect(translateText).toHaveBeenCalledOnce();
  });

  it('shows a recoverable translation error and allows a manual retry', async () => {
    let callbacks: Parameters<VoiceSessionFactory>[0] | undefined;
    const translateText = vi
      .fn<(text: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('Gemini đang giới hạn lượt dịch.'))
      .mockResolvedValueOnce('Bản dịch sau khi thử lại.');
    render(
      <VoiceSessionPanel
        sessionFactory={(value) => {
          callbacks = value;
          return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), sendText: vi.fn() };
        }}
        translateText={translateText}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-start-mic'));
    act(() => callbacks?.onTranscript('assistant', 'Please try again later.', true));
    fireEvent.click(screen.getByTestId('btn-translate-turn-1'));

    expect(await screen.findByText('Gemini đang giới hạn lượt dịch.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('btn-translate-turn-1'));
    expect((await screen.findByTestId('translation-turn-1')).textContent).toContain(
      'Bản dịch sau khi thử lại.',
    );
    expect(translateText).toHaveBeenCalledTimes(2);
  });

  it('loads due cards only when requested and starts with at most three selected review targets', async () => {
    let callbacks: Parameters<VoiceSessionFactory>[0] | undefined;
    const loadDueCards = vi.fn().mockResolvedValue([1, 2, 3, 4].map(createDueCard));
    render(
      <VoiceSessionPanel
        sessionFactory={(value) => {
          callbacks = value;
          return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), sendText: vi.fn() };
        }}
        translateText={vi.fn().mockResolvedValue('')}
        loadDueCards={loadDueCards}
      />,
    );
    expect(loadDueCards).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('btn-active-srs'));
    await screen.findByText('4 thẻ đến hạn · đã chọn 3/3');
    expect(loadDueCards).toHaveBeenCalledOnce();
    expect(screen.getByRole('checkbox', { name: /reliable/i }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /diligent/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /reliable/i }));
    fireEvent.change(screen.getByTestId('roleplay-select'), {
      target: { value: 'job_interview' },
    });
    fireEvent.click(screen.getByTestId('coaching-toggle'));
    fireEvent.click(screen.getByTestId('btn-start-mic'));

    expect(callbacks?.sessionContext).toEqual({
      scenario: 'job_interview',
      coachingEnabled: false,
      focusWords: [
        { word: 'overwhelmed', meaningVi: 'nghĩa 2' },
        { word: 'scissors', meaningVi: 'nghĩa 3' },
        { word: 'reliable', meaningVi: 'nghĩa 4' },
      ],
    });
  });

  it('shows a grounded correction, shadowing prompt and local session report after Stop', () => {
    let callbacks: Parameters<VoiceSessionFactory>[0] | undefined;
    render(
      <VoiceSessionPanel
        sessionFactory={(value) => {
          callbacks = value;
          return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), sendText: vi.fn() };
        }}
        translateText={vi.fn().mockResolvedValue('')}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-start-mic'));
    act(() => {
      callbacks?.onStateChange('listening');
      callbacks?.onTranscript('user', 'I go to cinema yesterday.', true);
      callbacks?.onTranscript('assistant', 'You went to the cinema yesterday.', true);
      callbacks?.onCoachCorrection?.({
        source_excerpt: 'I go to cinema yesterday.',
        learner_phrase: 'I go to cinema yesterday',
        suggested_sentence: 'I went to the cinema yesterday.',
        focus_phrase: 'went to the cinema',
        category: 'grammar',
      });
      callbacks?.onSpeechActivity?.(3500);
    });
    fireEvent.click(screen.getByTestId('btn-stop-mic'));

    expect(screen.getByTestId('coach-correction-turn-1').textContent).toContain(
      'went to the cinema',
    );
    expect(screen.getByTestId('session-insights').textContent).toContain('4 giây');
    expect(screen.getByTestId('session-insights').textContent).toContain('5/5');
    fireEvent.click(screen.getByTestId('btn-shadow-turn-1'));
    expect(screen.getByTestId('session-insights').textContent).toContain('Gợi ý coaching');
    expect(screen.getByText(/Hãy đọc câu gợi ý qua micro/)).toBeTruthy();
  });
});
