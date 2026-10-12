import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSessionPanel, type VoiceSessionFactory } from './VoiceSessionPanel.js';
import {
  AudioSessionController,
  downsampleFloat32ToInt16Pcm,
} from '../services/audio-session-controller.js';

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
    render(<VoiceSessionPanel sessionFactory={factory} enabled={false} />);
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
});
