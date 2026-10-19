import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GeminiLiveSessionClient,
  type TutorSessionContext,
  type VerifiedSaveVocabularyEvent,
} from './gemini-live-client.js';
import { TestWebSocket } from './test-websocket.js';

const clients: GeminiLiveSessionClient[] = [];
afterEach(() => {
  clients.forEach((client) => client.stop());
  clients.length = 0;
  vi.useRealTimers();
});
function setup(sessionContext?: TutorSessionContext) {
  const sockets: TestWebSocket[] = [];
  const callbacks = {
    onStateChange: vi.fn(),
    onTranscript: vi.fn(),
    onAudioChunk: vi.fn(),
    onCoachCorrection: vi.fn(),
    onError: vi.fn(),
    ...(sessionContext ? { sessionContext } : {}),
    onSaveVocabulary: vi
      .fn<(_event: VerifiedSaveVocabularyEvent) => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true }),
  };
  const client = new GeminiLiveSessionClient(callbacks, (url) => {
    const ws = new TestWebSocket(url);
    sockets.push(ws);
    return ws;
  });
  clients.push(client);
  return { client, sockets, callbacks };
}
const tool = {
  toolCall: {
    functionCalls: [
      {
        id: 'call-1',
        name: 'save_vocabulary',
        args: { word: 'bank', meaning_vi: 'ngân hàng', source_excerpt: 'What does bank mean?' },
      },
    ],
  },
};
describe('M5-05 Live protocol, trusted transcript and reconnect', () => {
  it('waits for setupComplete, sends PCM and text; validates and deduplicates tool frames', async () => {
    const { client, sockets, callbacks } = setup();
    client.connect({ ephemeralToken: 'synthetic-token' });
    const ws = sockets[0]!;
    ws.onopen?.({});
    client.sendPcmAudioChunk('AAAA');
    expect(ws.sent).toHaveLength(1);
    const declaration = JSON.parse(ws.sent[0]!).setup.tools[0].functionDeclarations[0];
    expect(declaration.name).toBe('save_vocabulary');
    expect(declaration.behavior).toBe('NON_BLOCKING');
    ws.emit({ setupComplete: {} });
    await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenLastCalledWith('listening'));
    client.sendPcmAudioChunk('AAAA');
    expect(JSON.parse(ws.sent[1]!).realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(client.sendText('What does bank mean?')).toBe(true);
    ws.emit(tool);
    ws.emit(tool);
    await vi.waitFor(() =>
      expect(ws.sent.filter((frame) => frame.includes('functionResponses'))).toHaveLength(2),
    );
    expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1);
    expect(callbacks.onSaveVocabulary.mock.calls[0]?.[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(ws.sent.at(-1)!).toolResponse.functionResponses[0].response).toEqual({
      saved: true,
      scheduling: 'SILENT',
    });
  });
  it('accumulates streamed transcript before tool validation and handles PCM playback', async () => {
    const { client, sockets, callbacks } = setup();
    client.connect({ ephemeralToken: 'synthetic-token' });
    const ws = sockets[0]!;
    ws.emit({ serverContent: { inputTranscription: { text: 'What does ' } } });
    ws.emit({ serverContent: { inputTranscription: { text: 'bank mean?' } } });
    ws.emit(tool);
    ws.emit({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
        outputTranscription: { text: 'A bank is a financial institution.' },
        turnComplete: true,
      },
    });
    await vi.waitFor(() => expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(callbacks.onAudioChunk).toHaveBeenCalledWith('AAAA', 'audio/pcm;rate=24000'),
    );
    expect(callbacks.onTranscript).toHaveBeenCalledWith('user', 'What does bank mean?', true);
  });
  it('R09 blocks hallucinated target or forged source and sends saved:false', async () => {
    const { client, sockets, callbacks } = setup();
    client.connect({ ephemeralToken: 'synthetic-token' });
    client.recordTurnContext({ speaker: 'user', text: 'What does bank mean?' });
    sockets[0]!.emit({
      toolCall: {
        functionCalls: [
          {
            ...tool.toolCall.functionCalls[0]!,
            args: { word: 'elephant', meaning_vi: 'voi', source_excerpt: 'What does bank mean?' },
          },
        ],
      },
    });
    await vi.waitFor(() => expect(sockets[0]!.sent).toHaveLength(1));
    expect(callbacks.onSaveVocabulary).not.toHaveBeenCalled();
    expect(JSON.parse(sockets[0]!.sent[0]!).toolResponse.functionResponses[0].response.saved).toBe(
      false,
    );
  });
  it('builds roleplay and due-word context and accepts only grounded non-blocking coaching', async () => {
    const context: TutorSessionContext = {
      scenario: 'job_interview',
      coachingEnabled: true,
      focusWords: [{ word: 'diligent', meaningVi: 'chăm chỉ' }],
    };
    const { client, sockets, callbacks } = setup(context);
    client.connect({ ephemeralToken: 'synthetic-token' });
    const ws = sockets[0]!;
    ws.onopen?.({});
    const setupMessage = JSON.parse(ws.sent[0]!).setup;
    expect(setupMessage.systemInstruction.parts[0].text).toContain('job interview');
    expect(setupMessage.systemInstruction.parts[0].text).toContain('diligent');
    expect(
      setupMessage.tools[0].functionDeclarations.map((item: { name: string }) => item.name),
    ).toEqual(['save_vocabulary', 'coach_correction']);

    client.recordTurnContext({ speaker: 'user', text: 'I go to cinema yesterday.' });
    ws.emit({
      toolCall: {
        functionCalls: [
          {
            id: 'coach-1',
            name: 'coach_correction',
            args: {
              source_excerpt: 'I go to cinema yesterday.',
              learner_phrase: 'I go to cinema yesterday',
              suggested_sentence: 'I went to the cinema yesterday.',
              focus_phrase: 'went to the cinema',
              category: 'grammar',
            },
          },
        ],
      },
    });
    await vi.waitFor(() => expect(callbacks.onCoachCorrection).toHaveBeenCalledOnce());
    expect(JSON.parse(ws.sent.at(-1)!).toolResponse.functionResponses[0]).toEqual({
      id: 'coach-1',
      name: 'coach_correction',
      response: { accepted: true, scheduling: 'SILENT' },
    });
  });
  it('omits coaching tool and rejects correction outside the latest user turn', async () => {
    const context: TutorSessionContext = {
      scenario: 'free_talk',
      coachingEnabled: false,
      focusWords: [],
    };
    const { client, sockets, callbacks } = setup(context);
    client.connect({ ephemeralToken: 'synthetic-token' });
    const ws = sockets[0]!;
    ws.onopen?.({});
    expect(JSON.parse(ws.sent[0]!).setup.tools[0].functionDeclarations).toHaveLength(1);
    client.recordTurnContext({ speaker: 'user', text: 'I feel tired today.' });
    ws.emit({
      toolCall: {
        functionCalls: [
          {
            id: 'coach-2',
            name: 'coach_correction',
            args: {
              source_excerpt: 'I feel tired today.',
              learner_phrase: 'I feel tired today',
              suggested_sentence: 'I felt tired today.',
              focus_phrase: 'felt',
              category: 'grammar',
            },
          },
        ],
      },
    });
    await vi.waitFor(() => expect(ws.sent).toHaveLength(2));
    expect(callbacks.onCoachCorrection).not.toHaveBeenCalled();
    expect(JSON.parse(ws.sent.at(-1)!).toolResponse.functionResponses[0].response.accepted).toBe(
      false,
    );
  });
  it.each(['goAway', 'unexpected-close'])(
    'R07 resumes after %s and cancels scheduled reconnect on Stop',
    async (cause) => {
      vi.useFakeTimers();
      const { client, sockets } = setup();
      client.connect({ ephemeralToken: 'synthetic-token' });
      sockets[0]!.emit({
        sessionResumptionUpdate: { newHandle: 'resume-handle', resumable: true },
      });
      await vi.advanceTimersByTimeAsync(1);
      if (cause === 'goAway') sockets[0]!.emit({ goAway: { timeLeft: '5s' } });
      else sockets[0]!.close(1006);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sockets).toHaveLength(2);
      sockets[1]!.onopen?.({});
      expect(JSON.parse(sockets[1]!.sent[0]!).setup.sessionResumption.handle).toBe('resume-handle');
      sockets[1]!.close(1006);
      client.stop();
      await vi.advanceTimersByTimeAsync(30000);
      expect(sockets).toHaveLength(2);
    },
  );
  it('refreshes a spent token when no handle exists and stops after bounded reconnect failures', async () => {
    vi.useFakeTimers();
    const { client, sockets, callbacks } = setup();
    const refresh = vi.fn().mockResolvedValue({
      token: 'new-token',
      model: 'models/gemini-3.8-live',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    client.connect({ ephemeralToken: 'old-token', getFreshToken: refresh });
    sockets[0]!.close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets[1]?.url).toContain('new-token');
    for (let index = 1; index <= 4; index++) {
      sockets[index]!.close(1006);
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(callbacks.onError).toHaveBeenCalled();
    expect(sockets).toHaveLength(5);
  });
  it('parses ArrayBuffer frames and reports invalid payloads without leaking frame content', async () => {
    const { client, sockets, callbacks } = setup();
    client.connect({ ephemeralToken: 'synthetic-token' });
    sockets[0]!.onmessage?.({ data: new TextEncoder().encode('{"setupComplete":{}}').buffer });
    await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenLastCalledWith('listening'));
    sockets[0]!.onmessage?.({ data: 'not-json-synthetic-secret' });
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalled());
    expect(callbacks.onError.mock.calls[0]?.[0]).not.toContain('synthetic-secret');
  });
});
