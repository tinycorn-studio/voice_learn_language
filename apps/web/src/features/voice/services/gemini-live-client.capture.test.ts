import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiLiveSessionClient, type VerifiedSaveVocabularyEvent } from './gemini-live-client.js';
import { TestWebSocket } from './test-websocket.js';

const clients: GeminiLiveSessionClient[] = [];
afterEach(() => {
  clients.forEach((client) => client.stop());
  clients.length = 0;
  vi.useRealTimers();
});
const question = 'What does overwhelmed mean?';
const tool = (id = 'capture-1') => ({
  toolCall: {
    functionCalls: [
      {
        id,
        name: 'save_vocabulary',
        args: { word: 'overwhelmed', meaning_vi: 'quá tải', source_excerpt: question },
      },
    ],
  },
});
const transcript = (text = question) => ({
  serverContent: { inputTranscription: { text, finished: true } },
});
function setup() {
  const ws = new TestWebSocket('synthetic://capture');
  const callbacks = {
    onStateChange: vi.fn(),
    onTranscript: vi.fn(),
    onAudioChunk: vi.fn(),
    onError: vi.fn(),
    onVocabularyCaptureStatus: vi.fn(),
    onCaptureDiagnostic: vi.fn(),
    onSaveVocabulary: vi
      .fn<(_event: VerifiedSaveVocabularyEvent) => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true }),
  };
  const client = new GeminiLiveSessionClient(callbacks, () => ws);
  clients.push(client);
  client.connect({ ephemeralToken: 'synthetic-token' });
  ws.onopen?.({});
  ws.emit({ setupComplete: {} });
  return { client, ws, callbacks };
}

describe('M5-12 vocabulary capture recovery', () => {
  it('caps tool recovery at ten requests per Start even if the model keeps omitting saves', async () => {
    vi.useFakeTimers();
    const { ws, callbacks } = setup();
    for (let index = 0; index < 11; index++) {
      ws.emit(transcript());
      ws.emit({ serverContent: { turnComplete: true } });
      await vi.advanceTimersByTimeAsync(13000);
    }
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(10);
    expect(callbacks.onSaveVocabulary).not.toHaveBeenCalled();
    expect(callbacks.onVocabularyCaptureStatus).toHaveBeenLastCalledWith({
      word: 'overwhelmed',
      status: 'failed',
    });
  });
  it('waits for a late transcript instead of caching a terminal failure', async () => {
    const { ws, callbacks } = setup();
    ws.emit(tool());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ws.sent.filter((frame) => frame.includes('functionResponses'))).toHaveLength(0);
    ws.emit(transcript());
    await vi.waitFor(() => expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1));
  });
  it('accepts ASR punctuation differences and persists the actual transcript', async () => {
    const { ws, callbacks } = setup();
    ws.emit(transcript('What does overwhelmed mean'));
    ws.emit(tool());
    await vi.waitFor(() => expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1));
    expect(callbacks.onSaveVocabulary.mock.calls[0]?.[0].source_excerpt).toBe(
      'What does overwhelmed mean',
    );
    expect(callbacks.onCaptureDiagnostic.mock.calls.map(([entry]) => entry.stage)).toEqual(
      expect.arrayContaining(['inquiry_detected', 'persistence_started', 'persistence_saved']),
    );
    expect(
      callbacks.onCaptureDiagnostic.mock.calls.find(
        ([entry]) => entry.stage === 'persistence_saved',
      )?.[0].persistence_duration_ms,
    ).toEqual(expect.any(Number));
    expect(JSON.stringify(callbacks.onCaptureDiagnostic.mock.calls)).not.toContain('overwhelmed');
  });
  it('recovers a missing tool once after the assistant turn, deduplicating late/new tool IDs', async () => {
    vi.useFakeTimers();
    const { ws, callbacks } = setup();
    ws.emit(transcript());
    await vi.advanceTimersByTimeAsync(3000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(0);
    ws.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(1);
    ws.emit(tool('late-original'));
    ws.emit(tool('recovered-call'));
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1);
    ws.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(20000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(1);
  });
  it('keeps audio flowing while persistence waits for backend acknowledgement', async () => {
    const { ws, callbacks } = setup();
    let acknowledge!: (result: { ok: boolean }) => void;
    callbacks.onSaveVocabulary.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    ws.emit(transcript());
    ws.emit(tool());
    await vi.waitFor(() => expect(callbacks.onSaveVocabulary).toHaveBeenCalledOnce());
    expect(callbacks.onVocabularyCaptureStatus).toHaveBeenLastCalledWith({
      word: 'overwhelmed',
      status: 'pending',
    });
    ws.emit({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
      },
    });
    try {
      await vi.waitFor(() => expect(callbacks.onAudioChunk).toHaveBeenCalledOnce(), {
        timeout: 100,
      });
      expect(ws.sent.filter((frame) => frame.includes('functionResponses'))).toHaveLength(0);
      expect(callbacks.onVocabularyCaptureStatus).toHaveBeenLastCalledWith({
        word: 'overwhelmed',
        status: 'pending',
      });
    } finally {
      acknowledge({ ok: true });
    }
    await vi.waitFor(() =>
      expect(ws.sent.filter((frame) => frame.includes('functionResponses'))).toHaveLength(1),
    );
    const response = JSON.parse(ws.sent.at(-1)!).toolResponse.functionResponses[0].response;
    expect(response).toEqual({ saved: true, scheduling: 'SILENT' });
    expect(callbacks.onVocabularyCaptureStatus).toHaveBeenLastCalledWith({
      word: 'overwhelmed',
      status: 'saved',
    });
  });
  it('does not recover ordinary conversation and cancels recovery on Stop', async () => {
    vi.useFakeTimers();
    const { client, ws, callbacks } = setup();
    ws.emit(transcript('I feel overwhelmed today.'));
    ws.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(0);
    ws.emit(transcript());
    ws.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(1);
    client.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(0);
    expect(callbacks.onSaveVocabulary).not.toHaveBeenCalled();
  });
  it('times out missing transcripts and a missing recovery result without repeated AI requests', async () => {
    vi.useFakeTimers();
    const { ws, callbacks } = setup();
    ws.emit(tool());
    await vi.advanceTimersByTimeAsync(7000);
    expect(ws.sent.some((frame) => frame.includes('transcript_unavailable'))).toBe(true);
    expect(callbacks.onSaveVocabulary).not.toHaveBeenCalled();
    ws.emit(transcript());
    ws.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(13000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(1);
    expect(callbacks.onVocabularyCaptureStatus).toHaveBeenLastCalledWith({
      word: 'overwhelmed',
      status: 'failed',
    });
    ws.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(20000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(1);
  });
  it('rejects a different source and stale tool IDs across a fresh Start', async () => {
    vi.useFakeTimers();
    const { client, ws, callbacks } = setup();
    ws.emit(transcript('What does bank mean?'));
    ws.emit(tool());
    await vi.advanceTimersByTimeAsync(7000);
    expect(callbacks.onSaveVocabulary).not.toHaveBeenCalled();
    client.stop();
    client.connect({ ephemeralToken: 'synthetic-new-session' });
    ws.emit(transcript());
    ws.emit(tool());
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1);
  });
  it('accepts a final ASR frame arriving after turnComplete and only persists one payload for parallel tools', async () => {
    vi.useFakeTimers();
    const { ws, callbacks } = setup();
    ws.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(50);
    ws.emit(transcript());
    await vi.advanceTimersByTimeAsync(2000);
    expect(ws.sent.filter((frame) => frame.includes('clientContent'))).toHaveLength(1);
    let acknowledge!: (result: { ok: boolean }) => void;
    callbacks.onSaveVocabulary.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    ws.emit(tool('one'));
    ws.emit(tool('two'));
    ws.emit(tool('one'));
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1);
    acknowledge({ ok: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.sent.filter((frame) => frame.includes('"saved":true'))).toHaveLength(3);
  });
  it('automatically captures vocabulary when learner code-switches with a Vietnamese word in English', async () => {
    vi.useFakeTimers();
    const { ws, callbacks } = setup();
    const codeSwitchUtterance = 'I want to buy a ... cái kéo';
    ws.emit(transcript(codeSwitchUtterance));
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onVocabularyCaptureStatus).toHaveBeenCalledWith({
      word: 'cái kéo',
      status: 'pending',
    });
    ws.emit({
      toolCall: {
        functionCalls: [
          {
            id: 'cs-tool-1',
            name: 'save_vocabulary',
            args: {
              word: 'scissors',
              lemma: 'scissors',
              part_of_speech: 'noun',
              meaning_vi: 'cái kéo',
              example: 'I need scissors to cut the paper.',
              source_excerpt: codeSwitchUtterance,
            },
          },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onSaveVocabulary).toHaveBeenCalledTimes(1);
    expect(callbacks.onSaveVocabulary).toHaveBeenCalledWith(
      expect.objectContaining({
        word: 'scissors',
        meaning_vi: 'cái kéo',
        source_excerpt: codeSwitchUtterance,
      }),
    );
    expect(callbacks.onVocabularyCaptureStatus).toHaveBeenLastCalledWith({
      word: 'cái kéo',
      status: 'saved',
    });
  });
});
