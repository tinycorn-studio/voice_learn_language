import { describe, expect, it, vi } from 'vitest';
import { createVoiceSession } from './voice-session.js';
import { TestWebSocket } from './test-websocket.js';
import type { VoiceAudioSession } from './browser-audio-session.js';
describe('Voice audio/token/socket lifecycle', () => {
  it('sends captured PCM, plays model output, and releases audio/socket on Stop', async () => {
    let pcm: ((data: string) => void) | undefined;
    const audio: VoiceAudioSession = {
      start: async (callback) => {
        pcm = callback;
      },
      stop: vi.fn(),
      play: vi.fn(),
      interrupt: vi.fn(),
    };
    const sockets: TestWebSocket[] = [];
    const onStateChange = vi.fn();
    const session = createVoiceSession(
      async () => ({
        token: 'synthetic-token',
        model: 'models/gemini-3.8-live',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }),
      {
        onStateChange,
        onTranscript: vi.fn(),
        onAudioChunk: vi.fn(),
        onSaveVocabulary: async () => ({ ok: true }),
      },
      audio,
      (url) => {
        const ws = new TestWebSocket(url);
        sockets.push(ws);
        return ws;
      },
    );
    await session.start();
    sockets[0]!.onopen?.({});
    sockets[0]!.emit({ setupComplete: {} });
    await vi.waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith('listening'));
    pcm?.('AAAA');
    expect(sockets[0]!.sent.at(-1)).toContain('audio/pcm;rate=16000');
    sockets[0]!.emit({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
      },
    });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledWith('AAAA', 'audio/pcm;rate=24000'));
    sockets[0]!.emit({ serverContent: { interrupted: true } });
    await vi.waitFor(() => expect(audio.interrupt).toHaveBeenCalled());
    session.stop();
    expect(audio.stop).toHaveBeenCalled();
    expect(sockets[0]!.readyState).toBe(3);
  });
  it('Stop during token request prevents a late WebSocket and releases microphone', async () => {
    let resolve:
      ((token: { token: string; model: string; expires_at: string }) => void) | undefined;
    const audio: VoiceAudioSession = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      play: vi.fn(),
      interrupt: vi.fn(),
    };
    const wsFactory = vi.fn();
    const session = createVoiceSession(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
      {
        onStateChange: vi.fn(),
        onTranscript: vi.fn(),
        onAudioChunk: vi.fn(),
        onSaveVocabulary: async () => ({ ok: true }),
      },
      audio,
      wsFactory,
    );
    const pending = session.start();
    await Promise.resolve();
    session.stop();
    resolve?.({
      token: 'late-token',
      model: 'models/synthetic',
      expires_at: new Date().toISOString(),
    });
    await pending;
    expect(wsFactory).not.toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });
});
