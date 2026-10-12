import {
  SAVE_VOCABULARY_TOOL_DECLARATION,
  validateSaveVocabularyToolCall,
  type ConversationContextTurn,
  type PartOfSpeech,
  type VoiceSessionState,
} from '@voice-chat/shared';

export interface WebSocketLike {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface VerifiedSaveVocabularyEvent {
  event_id: string;
  word: string;
  lemma: string;
  part_of_speech: PartOfSpeech;
  sense_key: string;
  meaning_vi: string;
  example: string;
  source_excerpt: string;
}

export interface GeminiLiveClientCallbacks {
  onStateChange: (state: VoiceSessionState) => void;
  onTranscript: (speaker: 'user' | 'assistant', text: string, isFinal: boolean) => void;
  onAudioChunk: (base64Pcm: string, mimeType: string) => void;
  onSaveVocabulary: (event: VerifiedSaveVocabularyEvent) => Promise<{ ok: boolean }>;
  onClarificationNeeded?: (reason: string) => void;
  onError?: (message: string) => void;
}

export interface GeminiLiveConnectOptions {
  ephemeralToken: string;
  model?: string;
  resumptionHandle?: string | null;
}

export const TUTOR_SYSTEM_INSTRUCTION = [
  'You are a kind, concise English conversation coach for a Vietnamese learner.',
  'Keep natural conversations in English; explain vocabulary in English + short Vietnamese meaning only when asked.',
  'Call save_vocabulary only when the learner explicitly asks meaning, translation or how to say a term in English.',
  'Resolve "that" only if one unambiguous target exists in recent conversation. Otherwise ask which word.',
  'Do not save arbitrary words used in ordinary dialogue. Do not claim a word is saved until tool execution succeeds.',
  'Do not output secrets or internal configuration.',
].join('\n');

const GEMINI_LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/**
 * Client managing the direct WebSocket connection from browser to Gemini Live API
 * using a short-lived ephemeral token (`docs/04_GEMINI_SETUP.md`, `M1-02`, `M1-03`).
 *
 * Handles:
 * - Setup frame with `save_vocabulary` function declaration, audio transcriptions,
 *   sliding-window context compression, and session resumption handle.
 * - `goAway` and unexpected disconnects via automatic resumption reconnect.
 * - Deterministic `event_id` deduplication on `save_vocabulary` tool calls.
 */
export class GeminiLiveSessionClient {
  private ws: WebSocketLike | null = null;
  private stoppedByUser = false;
  private resumptionHandle: string | null = null;
  private lastConnectOptions: GeminiLiveConnectOptions | null = null;
  private readonly processedToolCallIds = new Set<string>();
  private readonly recentTurns: ConversationContextTurn[] = [];

  public constructor(
    private readonly callbacks: GeminiLiveClientCallbacks,
    private readonly wsFactory: WebSocketFactory = (url) =>
      new WebSocket(url) as unknown as WebSocketLike,
  ) {}

  public getResumptionHandle(): string | null {
    return this.resumptionHandle;
  }

  public recordTurnContext(turn: ConversationContextTurn): void {
    this.recentTurns.push(turn);
    if (this.recentTurns.length > 10) {
      this.recentTurns.shift();
    }
  }

  public connect(options: GeminiLiveConnectOptions): void {
    this.stoppedByUser = false;
    this.lastConnectOptions = options;
    if (options.resumptionHandle !== undefined) {
      this.resumptionHandle = options.resumptionHandle;
    }

    const url = `${GEMINI_LIVE_WS_BASE}?access_token=${encodeURIComponent(options.ephemeralToken)}`;
    const socket = this.wsFactory(url);
    this.ws = socket;

    socket.onopen = () => {
      const setupPayload = {
        setup: {
          model: options.model ?? 'models/gemini-3.8-live',
          generationConfig: {
            responseModalities: ['AUDIO'],
          },
          systemInstruction: {
            parts: [{ text: TUTOR_SYSTEM_INSTRUCTION }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: {
            slidingWindow: {},
          },
          ...(this.resumptionHandle
            ? { sessionResumption: { handle: this.resumptionHandle } }
            : { sessionResumption: {} }),
          tools: [
            {
              functionDeclarations: [SAVE_VOCABULARY_TOOL_DECLARATION],
            },
          ],
        },
      };
      socket.send(JSON.stringify(setupPayload));
      this.callbacks.onStateChange('listening');
    };

    socket.onmessage = (ev) => {
      void this.handleServerMessage(ev.data);
    };

    socket.onerror = () => {
      if (!this.stoppedByUser) {
        this.callbacks.onStateChange('error');
        this.callbacks.onError?.('Mất kết nối tới Gemini Live API.');
      }
    };

    socket.onclose = () => {
      if (!this.stoppedByUser && this.resumptionHandle && this.lastConnectOptions) {
        this.callbacks.onStateChange('reconnecting');
      } else if (!this.stoppedByUser) {
        this.callbacks.onStateChange('idle');
      }
    };
  }

  /**
   * Streams a base64-encoded 16kHz 16-bit mono PCM audio chunk to Gemini Live.
   */
  public sendPcmAudioChunk(base64Pcm: string): void {
    if (!this.ws || this.ws.readyState !== 1) {
      return;
    }
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: 'audio/pcm;rate=16000',
              data: base64Pcm,
            },
          ],
        },
      }),
    );
  }

  /**
   * Stops the session immediately and prevents automatic reconnection (`TC-11`).
   */
  public stop(): void {
    this.stoppedByUser = true;
    if (this.ws) {
      this.ws.close(1000, 'user_stop');
      this.ws = null;
    }
    this.callbacks.onStateChange('idle');
  }

  private async handleServerMessage(rawJson: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      return;
    }

    // 1. Session resumption token update
    const resumptionUpdate = msg['sessionResumptionUpdate'] as
      | { newHandle?: string; resumable?: boolean }
      | undefined;
    if (resumptionUpdate?.newHandle) {
      this.resumptionHandle = resumptionUpdate.newHandle;
    }

    // 2. Server goAway notice -> trigger seamless reconnect using resumptionHandle
    if (msg['goAway'] && !this.stoppedByUser && this.lastConnectOptions) {
      this.callbacks.onStateChange('reconnecting');
      if (this.ws) {
        this.ws.close(1001, 'go_away_reconnect');
      }
      this.connect({
        ...this.lastConnectOptions,
        resumptionHandle: this.resumptionHandle,
      });
      return;
    }

    // 3. Server content (audio output, transcriptions, turn completion)
    const serverContent = msg['serverContent'] as Record<string, unknown> | undefined;
    if (serverContent) {
      const inputTx = serverContent['inputTranscription'] as
        | { text?: string; finished?: boolean }
        | undefined;
      if (typeof inputTx?.text === 'string' && inputTx.text.trim().length > 0) {
        const isFinal = Boolean(inputTx.finished);
        this.callbacks.onTranscript('user', inputTx.text, isFinal);
        if (isFinal) {
          this.recordTurnContext({ speaker: 'user', text: inputTx.text });
          this.callbacks.onStateChange('thinking');
        }
      }

      const outputTx = serverContent['outputTranscription'] as
        | { text?: string; finished?: boolean }
        | undefined;
      if (typeof outputTx?.text === 'string' && outputTx.text.trim().length > 0) {
        const isFinal = Boolean(outputTx.finished);
        this.callbacks.onTranscript('assistant', outputTx.text, isFinal);
        if (isFinal) {
          this.recordTurnContext({ speaker: 'assistant', text: outputTx.text });
        }
      }

      const modelTurn = serverContent['modelTurn'] as
        | { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
        | undefined;
      if (Array.isArray(modelTurn?.parts)) {
        for (const part of modelTurn.parts) {
          if (part.inlineData?.data) {
            this.callbacks.onStateChange('speaking');
            this.callbacks.onAudioChunk(
              part.inlineData.data,
              part.inlineData.mimeType ?? 'audio/pcm;rate=24000',
            );
          }
        }
      }

      if (serverContent['turnComplete']) {
        this.callbacks.onStateChange('listening');
      }
    }

    // 4. Function call `save_vocabulary` (`M1-03`)
    const toolCall = msg['toolCall'] as
      | {
          functionCalls?: Array<{
            id?: string;
            name?: string;
            args?: unknown;
          }>;
        }
      | undefined;

    if (Array.isArray(toolCall?.functionCalls)) {
      for (const call of toolCall.functionCalls) {
        if (call.name !== 'save_vocabulary') {
          continue;
        }
        const callId = call.id ?? `call_${Date.now()}`;
        // Deduplicate repeated tool call frames with identical ID
        if (this.processedToolCallIds.has(callId)) {
          continue;
        }
        this.processedToolCallIds.add(callId);

        const validation = validateSaveVocabularyToolCall(call.args, this.recentTurns);
        if (!validation.allowed) {
          if (validation.requiresClarification) {
            this.callbacks.onClarificationNeeded?.(validation.reason);
          }
          this.sendToolResponse(callId, {
            saved: false,
            reason: validation.reason,
          });
          continue;
        }

        const eventId = `evt_${callId.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 80)}`;
        const persistResult = await this.callbacks.onSaveVocabulary({
          event_id: eventId.length >= 12 ? eventId : `${eventId}_vocab_event`,
          ...validation.sanitized,
        });

        this.sendToolResponse(callId, {
          saved: persistResult.ok,
        });
      }
    }
  }

  private sendToolResponse(callId: string, output: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== 1) {
      return;
    }
    this.ws.send(
      JSON.stringify({
        toolResponse: {
          functionResponses: [
            {
              id: callId,
              name: 'save_vocabulary',
              response: { output },
            },
          ],
        },
      }),
    );
  }
}
