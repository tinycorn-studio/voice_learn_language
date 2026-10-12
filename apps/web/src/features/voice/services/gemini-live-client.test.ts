import { describe, expect, it, vi } from 'vitest';
import {
  GeminiLiveSessionClient,
  type VerifiedSaveVocabularyEvent,
  type WebSocketLike,
} from './gemini-live-client.js';
import type { VoiceSessionState } from '@voice-chat/shared';

class FakeWebSocket implements WebSocketLike {
  public readyState = 1;
  public sentFrames: string[] = [];
  public closed = false;
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;
  public onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;

  public constructor(public readonly url: string) {}

  public send(data: string): void {
    this.sentFrames.push(data);
  }

  public close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

describe('M1-02 & M1-03 GeminiLiveSessionClient', () => {
  it('connects with ephemeral token, sends setup frame with save_vocabulary tool, and handles audio/transcriptions', async () => {
    const sockets: FakeWebSocket[] = [];
    const states: VoiceSessionState[] = [];
    const transcripts: Array<{ speaker: string; text: string; isFinal: boolean }> = [];
    const audioChunks: string[] = [];
    const savedEvents: VerifiedSaveVocabularyEvent[] = [];

    const client = new GeminiLiveSessionClient(
      {
        onStateChange: (st) => states.push(st),
        onTranscript: (speaker, text, isFinal) => transcripts.push({ speaker, text, isFinal }),
        onAudioChunk: (chunk) => audioChunks.push(chunk),
        onSaveVocabulary: vi.fn().mockImplementation(async (evt: VerifiedSaveVocabularyEvent) => {
          savedEvents.push(evt);
          return { ok: true };
        }),
      },
      (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws;
      },
    );

    client.connect({ ephemeralToken: 'eph_test_token_123' });
    expect(sockets.length).toBe(1);
    const ws = sockets[0]!;
    expect(ws.url).toContain('access_token=eph_test_token_123');

    ws.onopen?.({});
    expect(states).toContain('listening');
    expect(ws.sentFrames.length).toBe(1);
    const setupMsg = JSON.parse(ws.sentFrames[0]!) as {
      setup: { model: string; tools: Array<{ functionDeclarations: Array<{ name: string }> }> };
    };
    expect(setupMsg.setup.model).toBe('models/gemini-3.8-live');
    expect(setupMsg.setup.tools[0]?.functionDeclarations[0]?.name).toBe('save_vocabulary');

    // Simulate user final transcript + model audio + turnComplete
    ws.onmessage?.({
      data: JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'What does overwhelmed mean?', finished: true },
        },
      }),
    });
    expect(states.at(-1)).toBe('thinking');

    ws.onmessage?.({
      data: JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { data: 'AAAABBBB', mimeType: 'audio/pcm;rate=24000' } }],
          },
          outputTranscription: { text: 'Overwhelmed means feeling unable to cope.', finished: true },
        },
      }),
    });
    expect(states.at(-1)).toBe('speaking');
    expect(audioChunks).toEqual(['AAAABBBB']);

    // Simulate valid save_vocabulary toolCall and duplicate frame
    const toolCallFrame = JSON.stringify({
      toolCall: {
        functionCalls: [
          {
            id: 'call_abc123456789',
            name: 'save_vocabulary',
            args: {
              word: 'overwhelmed',
              part_of_speech: 'adjective',
              meaning_vi: 'quá tải, choáng ngợp',
              source_excerpt: 'What does overwhelmed mean?',
            },
          },
        ],
      },
    });
    ws.onmessage?.({ data: toolCallFrame });
    ws.onmessage?.({ data: toolCallFrame });

    await vi.waitFor(() => {
      expect(savedEvents.length).toBe(1);
    });
    expect(savedEvents[0]?.word).toBe('overwhelmed');
  });

  it('automatically reconnects with sessionResumption handle upon receiving goAway', () => {
    const sockets: FakeWebSocket[] = [];
    const states: VoiceSessionState[] = [];

    const client = new GeminiLiveSessionClient(
      {
        onStateChange: (st) => states.push(st),
        onTranscript: () => undefined,
        onAudioChunk: () => undefined,
        onSaveVocabulary: async () => ({ ok: true }),
      },
      (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws;
      },
    );

    client.connect({ ephemeralToken: 'eph_1' });
    sockets[0]!.onopen?.({});

    // Server sends resumption handle update then goAway
    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        sessionResumptionUpdate: { newHandle: 'resume_handle_xyz', resumable: true },
      }),
    });
    expect(client.getResumptionHandle()).toBe('resume_handle_xyz');

    sockets[0]!.onmessage?.({
      data: JSON.stringify({ goAway: { timeLeft: '5s' } }),
    });

    expect(sockets.length).toBe(2);
    sockets[1]!.onopen?.({});
    const reconnectSetup = JSON.parse(sockets[1]!.sentFrames[0]!) as {
      setup: { sessionResumption?: { handle?: string } };
    };
    expect(reconnectSetup.setup.sessionResumption?.handle).toBe('resume_handle_xyz');

    client.stop();
    expect(sockets[1]!.closed).toBe(true);
    expect(states.at(-1)).toBe('idle');
  });
});
