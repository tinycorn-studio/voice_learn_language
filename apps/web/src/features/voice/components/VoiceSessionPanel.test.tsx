import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSessionPanel } from './VoiceSessionPanel.js';
import {
  downsampleFloat32ToInt16Pcm,
  type MediaDevicesLike,
  type MediaTrackLike,
} from '../services/audio-session-controller.js';

afterEach(() => {
  cleanup();
});

describe('M1-01 VoiceSessionPanel & AudioSessionController', () => {
  it('renders initial idle state and switches across all 6 canonical voice states', () => {
    render(<VoiceSessionPanel />);
    const badge = screen.getByTestId('voice-status-badge');
    expect(badge.getAttribute('data-state')).toBe('idle');

    for (const state of [
      'listening',
      'thinking',
      'speaking',
      'reconnecting',
      'error',
      'idle',
    ] as const) {
      fireEvent.click(screen.getByTestId(`btn-state-${state}`));
      expect(screen.getByTestId('voice-status-badge').getAttribute('data-state')).toBe(state);
    }
  });

  it('requests microphone on Start and stops all MediaStreamTracks on Stop (TC-11)', async () => {
    const stopSpy = vi.fn();
    const fakeTrack: MediaTrackLike = {
      kind: 'audio',
      readyState: 'live',
      stop: stopSpy,
    };
    const fakeMediaDevices: MediaDevicesLike = {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [fakeTrack],
        getAudioTracks: () => [fakeTrack],
      }),
    };

    render(<VoiceSessionPanel mediaDevices={fakeMediaDevices} />);
    fireEvent.click(screen.getByTestId('btn-start-mic'));

    await waitFor(() => {
      expect(screen.getByTestId('voice-status-badge').getAttribute('data-state')).toBe('listening');
    });
    expect(screen.getByTestId('mic-permission-state').textContent).toContain('granted');

    fireEvent.click(screen.getByTestId('btn-stop-mic'));
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('voice-status-badge').getAttribute('data-state')).toBe('idle');
  });

  it('shows clear error banner and sets permission to denied when user blocks microphone (TC-11)', async () => {
    const deniedError = new Error('Permission denied');
    deniedError.name = 'NotAllowedError';
    const fakeMediaDevices: MediaDevicesLike = {
      getUserMedia: vi.fn().mockRejectedValue(deniedError),
    };

    render(<VoiceSessionPanel mediaDevices={fakeMediaDevices} />);
    fireEvent.click(screen.getByTestId('btn-start-mic'));

    await waitFor(() => {
      expect(screen.getByTestId('voice-status-badge').getAttribute('data-state')).toBe('error');
    });
    expect(screen.getByTestId('mic-permission-state').textContent).toContain('denied');
    expect(screen.getByTestId('mic-error-banner').textContent).toContain('Quyền micro đã bị từ chối');
  });

  it('downsamples 48kHz Float32 audio to 16kHz Int16 PCM accurately', () => {
    const input = new Float32Array(480);
    input.fill(0.5);
    const out = downsampleFloat32ToInt16Pcm(input, 48000, 16000);
    expect(out.length).toBe(160);
    expect(out[0]).toBeGreaterThan(16000);
    expect(out[0]).toBeLessThan(16500);
  });
});
