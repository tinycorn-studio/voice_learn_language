import type { LiveTokenResponse } from '@voice-chat/shared';
import {
  GeminiLiveSessionClient,
  type GeminiLiveClientCallbacks,
  type WebSocketFactory,
} from './gemini-live-client.js';
import { BrowserAudioSession, type VoiceAudioSession } from './browser-audio-session.js';

export interface VoiceSession {
  start(): Promise<void>;
  stop(): void;
  sendText(text: string): boolean;
}

/** Owns mic, playback, token and WebSocket as one cancellable session. */
export function createVoiceSession(
  mintToken: () => Promise<LiveTokenResponse>,
  callbacks: GeminiLiveClientCallbacks,
  audio: VoiceAudioSession = new BrowserAudioSession(),
  wsFactory?: WebSocketFactory,
): VoiceSession {
  let generation = 0;
  const client = new GeminiLiveSessionClient(
    {
      ...callbacks,
      onAudioChunk: (chunk, mimeType) => {
        audio.play(chunk, mimeType);
        callbacks.onAudioChunk(chunk, mimeType);
      },
      onInterrupted: () => {
        audio.interrupt();
        callbacks.onInterrupted?.();
      },
      onError: (message) => {
        generation++;
        audio.stop();
        callbacks.onError?.(message);
      },
    },
    wsFactory,
  );
  return {
    async start() {
      const current = ++generation;
      client.stop(false);
      callbacks.onStateChange('reconnecting');
      try {
        await audio.start((pcm) => client.sendPcmAudioChunk(pcm));
        if (current !== generation) return;
        const token = await mintToken();
        if (current !== generation) return;
        client.connect({
          ephemeralToken: token.token,
          model: token.model,
          expiresAt: token.expires_at,
          getFreshToken: mintToken,
        });
      } catch (error) {
        if (current !== generation) return;
        client.stop(false);
        audio.stop();
        callbacks.onStateChange('error');
        callbacks.onError?.(
          error instanceof Error ? error.message : 'Không thể bắt đầu phiên voice.',
        );
      }
    },
    stop() {
      generation++;
      client.stop();
      audio.stop();
    },
    sendText: (text) => client.sendText(text),
  };
}
