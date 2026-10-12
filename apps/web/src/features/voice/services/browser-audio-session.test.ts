import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudioSession } from './browser-audio-session.js';

function audioHarness() {
  const track = { kind: 'audio', readyState: 'live', stop: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const playback = {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  };
  const worklet = {
    port: { onmessage: null as ((event: { data: Float32Array }) => void) | null },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const samples: Float32Array[] = [];
  const context = {
    currentTime: 10,
    sampleRate: 48000,
    state: 'running',
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createBufferSource: vi.fn(() => playback),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => {
      const channel = new Float32Array(length);
      samples.push(channel);
      return { duration: length / rate, getChannelData: () => channel };
    }),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor() {
        return worklet;
      }
    },
  );
  const session = new BrowserAudioSession({
    getUserMedia: vi
      .fn()
      .mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }),
  });
  return { session, context, worklet, playback, track, source, samples };
}
afterEach(() => vi.unstubAllGlobals());
describe('BrowserAudioSession PCM graph', () => {
  it('captures 48kHz as 16kHz little-endian PCM, plays declared rate and releases resources', async () => {
    const h = audioHarness();
    const capture = vi.fn();
    await h.session.start(capture);
    h.worklet.port.onmessage?.({ data: new Float32Array([1, 1, 1, -1, -1, -1]) });
    expect(
      [...atob(capture.mock.calls[0]![0] as string)].map((char) => char.charCodeAt(0)),
    ).toEqual([255, 127, 0, 128]);
    h.session.play(btoa(String.fromCharCode(255, 127, 0, 128)), 'audio/pcm;rate=24000');
    expect(h.context.createBuffer).toHaveBeenCalledWith(1, 2, 24000);
    expect(h.samples[0]?.[1]).toBe(-1);
    expect(h.playback.start).toHaveBeenCalledWith(10);
    h.session.interrupt();
    expect(h.playback.stop).toHaveBeenCalledOnce();
    h.session.stop();
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.source.disconnect).toHaveBeenCalledOnce();
    expect(h.worklet.port.onmessage).toBeNull();
    expect(h.context.close).toHaveBeenCalledOnce();
  });
  it('closes the audio context and cancels late microphone permission after resume failure', async () => {
    const h = audioHarness();
    h.context.resume.mockRejectedValueOnce(new Error('synthetic resume failure'));
    await expect(h.session.start(vi.fn())).rejects.toThrow('synthetic resume failure');
    expect(h.context.close).toHaveBeenCalledOnce();
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.context.createMediaStreamSource).not.toHaveBeenCalled();
  });
});
