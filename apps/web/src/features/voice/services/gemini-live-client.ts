import { z } from 'zod';
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
  onmessage: ((ev: { data: unknown }) => void) | null;
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
  onInterrupted?: () => void;
}
export interface GeminiLiveConnectOptions {
  ephemeralToken: string;
  model?: string;
  expiresAt?: string;
  resumptionHandle?: string | null;
  getFreshToken?: () => Promise<{ token: string; model: string; expires_at: string }>;
}
export const TUTOR_SYSTEM_INSTRUCTION = [
  'You are a kind, concise English conversation coach for a Vietnamese learner.',
  'Keep natural conversations in English; explain vocabulary in English + short Vietnamese meaning only when asked.',
  'Call save_vocabulary only when the learner explicitly asks meaning, translation or how to say a term in English.',
  'Copy source_excerpt exactly from the learner question. Save word must match the question target, or its English translation when asked how to say a Vietnamese term.',
  'Resolve "that" only if one unambiguous quoted target exists in recent conversation. Otherwise ask which word.',
  'Do not claim a word is saved until tool execution succeeds. Do not output secrets or internal configuration.',
].join('\n');
const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const transcriptionSchema = z.object({
  text: z.string().max(10000).optional(),
  finished: z.boolean().optional(),
});
const messageSchema = z.object({
  setupComplete: z.object({}).optional(),
  sessionResumptionUpdate: z
    .object({ newHandle: z.string().optional(), resumable: z.boolean().optional() })
    .optional(),
  goAway: z.object({ timeLeft: z.string().optional() }).optional(),
  serverContent: z
    .object({
      inputTranscription: transcriptionSchema.optional(),
      outputTranscription: transcriptionSchema.optional(),
      modelTurn: z
        .object({
          parts: z.array(
            z.object({
              inlineData: z
                .object({ data: z.string().max(2_000_000), mimeType: z.string() })
                .optional(),
            }),
          ),
        })
        .optional(),
      turnComplete: z.boolean().optional(),
      interrupted: z.boolean().optional(),
    })
    .optional(),
  toolCall: z
    .object({
      functionCalls: z
        .array(z.object({ id: z.string().min(1).max(256), name: z.string(), args: z.unknown() }))
        .max(10),
    })
    .optional(),
});

/** Direct browser Live connection. All retries are bounded and cancelled by Stop. */
export class GeminiLiveSessionClient {
  private ws: WebSocketLike | null = null;
  private stopped = true;
  private ready = false;
  private resumptionHandle: string | null = null;
  private options: GeminiLiveConnectOptions | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private setupTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private epoch = 0;
  private recentTurns: ConversationContextTurn[] = [];
  private inputText = '';
  private outputText = '';
  private messages: Promise<void> = Promise.resolve();
  private readonly toolResults = new Map<string, { saved: boolean; reason?: string }>();
  private readonly toolEvents = new Map<string, string>();

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
    this.recentTurns = this.recentTurns.slice(-10);
  }
  public connect(options: GeminiLiveConnectOptions): void {
    this.stop(false);
    this.stopped = false;
    this.options = options;
    this.retries = 0;
    this.resumptionHandle = options.resumptionHandle ?? null;
    this.openSocket();
  }
  private openSocket(): void {
    const options = this.options;
    if (!options || this.stopped) return;
    this.ready = false;
    const socket = this.wsFactory(
      `${WS_BASE}?access_token=${encodeURIComponent(options.ephemeralToken)}`,
    );
    this.ws = socket;
    this.callbacks.onStateChange('reconnecting');
    this.setupTimer = setTimeout(() => this.fail('Kết nối Gemini quá thời gian chờ.'), 15000);
    socket.onopen = () => {
      if (socket !== this.ws || this.stopped) return;
      socket.send(
        JSON.stringify({
          setup: {
            model: options.model ?? 'models/gemini-3.8-live',
            generationConfig: { responseModalities: ['AUDIO'] },
            systemInstruction: { parts: [{ text: TUTOR_SYSTEM_INSTRUCTION }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
            tools: [{ functionDeclarations: [SAVE_VOCABULARY_TOOL_DECLARATION] }],
          },
        }),
      );
    };
    socket.onmessage = (ev) => {
      this.messages = this.messages
        .then(async () => {
          if (this.stopped || socket !== this.ws) return;
          let raw: string;
          if (typeof ev.data === 'string') raw = ev.data;
          else if (ev.data instanceof Blob) raw = await ev.data.text();
          else if (Object.prototype.toString.call(ev.data) === '[object ArrayBuffer]')
            raw = new TextDecoder().decode(ev.data as ArrayBuffer);
          else if (ArrayBuffer.isView(ev.data)) raw = new TextDecoder().decode(ev.data);
          else throw new Error('Invalid WebSocket frame');
          if (this.stopped || socket !== this.ws) return;
          if (raw.length > 3_000_000) throw new Error('Oversized WebSocket frame');
          await this.handleMessage(messageSchema.parse(JSON.parse(raw)));
        })
        .catch(() => {
          if (!this.stopped && socket === this.ws)
            this.fail('Gemini trả về dữ liệu không hợp lệ hoặc xử lý phiên thất bại.');
        });
    };
    socket.onerror = () => {
      /* onclose determines whether the connection can resume. */
    };
    socket.onclose = (ev) => {
      if (this.stopped || socket !== this.ws) return;
      this.ws = null;
      this.ready = false;
      if (this.setupTimer) clearTimeout(this.setupTimer);
      if ([1007, 1008].includes(ev.code ?? 0))
        this.fail('Gemini từ chối phiên. Hãy kiểm tra cấu hình hoặc bắt đầu lại.');
      else this.scheduleReconnect();
    };
  }
  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    if (this.retries >= 4) {
      this.fail('Không thể kết nối lại Gemini. Hãy nhấn Start để thử lại.');
      return;
    }
    const delay = 500 * 2 ** this.retries++ + Math.random() * 250;
    this.callbacks.onStateChange('reconnecting');
    const epoch = this.epoch;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void (async () => {
        const options = this.options;
        if (!options || this.stopped || epoch !== this.epoch) return;
        const expired =
          options.expiresAt !== undefined && Date.parse(options.expiresAt) <= Date.now() + 5000;
        if (!this.resumptionHandle || expired) {
          if (!options.getFreshToken) {
            this.fail('Phiên đã hết hạn. Hãy bắt đầu lại.');
            return;
          }
          const token = await options.getFreshToken();
          if (this.stopped || epoch !== this.epoch) return;
          this.options = {
            ...options,
            ephemeralToken: token.token,
            model: token.model,
            expiresAt: token.expires_at,
          };
          if (expired) this.resumptionHandle = null;
        }
        this.openSocket();
      })().catch(() => {
        if (!this.stopped && epoch === this.epoch) this.scheduleReconnect();
      });
    }, delay);
  }
  public sendPcmAudioChunk(base64Pcm: string): void {
    if (this.ready && this.ws?.readyState === 1)
      this.ws.send(
        JSON.stringify({
          realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: base64Pcm } },
        }),
      );
  }
  public sendText(text: string): boolean {
    if (!this.ready || this.ws?.readyState !== 1 || !text.trim()) return false;
    this.recordTurnContext({ speaker: 'user', text: text.trim() });
    this.callbacks.onTranscript('user', text.trim(), true);
    this.ws.send(JSON.stringify({ realtimeInput: { text: text.trim() } }));
    return true;
  }
  public stop(notify = true): void {
    this.stopped = true;
    this.ready = false;
    this.epoch++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.setupTimer) clearTimeout(this.setupTimer);
    this.retryTimer = this.setupTimer = null;
    const socket = this.ws;
    this.ws = null;
    socket?.close(1000, 'user_stop');
    if (notify) this.callbacks.onStateChange('idle');
  }
  private fail(message: string): void {
    this.stop(false);
    this.callbacks.onStateChange('error');
    this.callbacks.onError?.(message);
  }
  private flushTranscript(speaker: 'user' | 'assistant'): void {
    const text = (speaker === 'user' ? this.inputText : this.outputText).trim();
    if (!text) return;
    this.recordTurnContext({ speaker, text });
    this.callbacks.onTranscript(speaker, text, true);
    if (speaker === 'user') this.inputText = '';
    else this.outputText = '';
  }
  private async handleMessage(msg: z.infer<typeof messageSchema>): Promise<void> {
    if (msg.setupComplete) {
      if (this.setupTimer) clearTimeout(this.setupTimer);
      this.ready = true;
      this.callbacks.onStateChange('listening');
    }
    if (msg.sessionResumptionUpdate) {
      if (msg.sessionResumptionUpdate.resumable === false) this.resumptionHandle = null;
      else if (msg.sessionResumptionUpdate.newHandle)
        this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
    }
    const content = msg.serverContent;
    if (content) {
      if (content.inputTranscription?.text) {
        this.inputText += content.inputTranscription.text;
        this.callbacks.onTranscript('user', this.inputText, false);
        if (content.inputTranscription.finished) {
          this.flushTranscript('user');
          this.callbacks.onStateChange('thinking');
        }
      }
      if (content.outputTranscription?.text) {
        this.flushTranscript('user');
        this.outputText += content.outputTranscription.text;
        this.callbacks.onTranscript('assistant', this.outputText, false);
        if (content.outputTranscription.finished) this.flushTranscript('assistant');
      }
      if (content.interrupted) {
        this.callbacks.onInterrupted?.();
        this.flushTranscript('assistant');
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData) {
          this.callbacks.onStateChange('speaking');
          this.callbacks.onAudioChunk(part.inlineData.data, part.inlineData.mimeType);
        }
      }
      if (content.turnComplete) {
        this.flushTranscript('user');
        this.flushTranscript('assistant');
        this.callbacks.onStateChange('listening');
      }
    }
    for (const call of msg.toolCall?.functionCalls ?? []) {
      if (call.name !== 'save_vocabulary') continue;
      this.flushTranscript('user');
      let result = this.toolResults.get(call.id);
      if (!result) {
        const validation = validateSaveVocabularyToolCall(call.args, this.recentTurns);
        if (!validation.allowed) {
          if (validation.requiresClarification)
            this.callbacks.onClarificationNeeded?.(validation.reason);
          result = { saved: false, reason: validation.reason };
        } else {
          const eventId = this.toolEvents.get(call.id) ?? crypto.randomUUID();
          this.toolEvents.set(call.id, eventId);
          try {
            result = {
              saved: (
                await this.callbacks.onSaveVocabulary({
                  event_id: eventId,
                  ...validation.sanitized,
                })
              ).ok,
            };
          } catch {
            result = { saved: false, reason: 'persistence_failed' };
          }
        }
        this.toolResults.set(call.id, result);
      }
      if (!this.stopped && this.ws?.readyState === 1)
        this.ws.send(
          JSON.stringify({
            toolResponse: {
              functionResponses: [{ id: call.id, name: call.name, response: result }],
            },
          }),
        );
    }
    if (msg.goAway && !this.stopped) {
      if (this.setupTimer) clearTimeout(this.setupTimer);
      const socket = this.ws;
      this.ws = null;
      socket?.close(1001, 'go_away_reconnect');
      this.scheduleReconnect();
    }
  }
}
