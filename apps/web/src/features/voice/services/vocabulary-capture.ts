import {
  detectVocabularyIntent,
  normalizeVocabularyQuestion,
  saveVocabularyToolArgsSchema,
  validateSaveVocabularyToolCall,
  type ConversationContextTurn,
} from '@voice-chat/shared';
import type { CaptureDiagnostic } from './capture-diagnostics.js';

type Fields = Extract<
  ReturnType<typeof validateSaveVocabularyToolCall>,
  { allowed: true }
>['sanitized'];
type ToolResult = { saved: boolean; reason?: string };
type Timer = ReturnType<typeof setTimeout>;
export interface VocabularyCaptureStatus {
  word: string;
  status: 'pending' | 'saved' | 'failed';
}
interface Inquiry {
  context: ConversationContextTurn[];
  word: string;
  eventId: string;
  operation: Promise<ToolResult> | null;
  recoveryRequested: boolean;
  grace: Timer | null;
  deadline: Timer | null;
  requestWaitStartedAt: number | null;
  startedAt: number;
}
interface PendingTool {
  id: string;
  args: unknown;
  timer: Timer;
}
interface CaptureCallbacks {
  save: (event: Fields & { event_id: string }) => Promise<{ ok: boolean }>;
  reply: (id: string, result: ToolResult) => void;
  recover: (question: string, target: string) => boolean;
  status: (status: VocabularyCaptureStatus) => void;
  clarify: (reason: string) => void;
  diagnostic?: (metadata: CaptureDiagnostic) => void;
}
const TRANSCRIPT_WAIT_MS = 6000;
const RECOVERY_GRACE_MS = 1500;
const RECOVERY_DEADLINE_MS = 10000;
const MAX_RECOVERIES = 10;

/** Session-only capture state. Persistence never blocks audio/transcription frame handling. */
export class VocabularyCapture {
  private active = false;
  private epoch = 0;
  private busy = false;
  private completedAt: number | null = null;
  private recoveryCount = 0;
  private recovering: Inquiry | null = null;
  private contexts: ConversationContextTurn[][] = [];
  private inquiries: Inquiry[] = [];
  private readonly pending = new Map<string, PendingTool>();
  private readonly results = new Map<string, ToolResult>();
  public constructor(private readonly callbacks: CaptureCallbacks) {}
  public start(): void {
    this.stop();
    this.active = true;
  }
  public stop(): void {
    this.active = false;
    this.epoch++;
    for (const tool of this.pending.values()) clearTimeout(tool.timer);
    for (const inquiry of this.inquiries) this.clearTimers(inquiry);
    this.pending.clear();
    this.results.clear();
    this.contexts = [];
    this.inquiries = [];
    this.recoveryCount = 0;
    this.recovering = null;
    this.completedAt = null;
    this.busy = false;
  }
  public observeUser(text: string, previous: readonly ConversationContextTurn[]): void {
    if (!this.active) return;
    const context: ConversationContextTurn[] = [...previous.slice(-9), { speaker: 'user', text }];
    this.contexts.push(context);
    this.contexts = this.contexts.slice(-30);
    const decision = detectVocabularyIntent(text, previous);
    if (decision.status !== 'save')
      this.trace(decision.status === 'ignore' ? 'intent_ignored' : 'intent_clarify', null);
    if (decision.status === 'clarify') this.callbacks.clarify(decision.reason);
    if (decision.status === 'save' && decision.targetWord) {
      if (this.inquiries.length >= 30) {
        const removed = this.inquiries.shift();
        if (removed) {
          this.clearTimers(removed);
          if (this.recovering === removed) this.recovering = null;
        }
      }
      const inquiry: Inquiry = {
        context,
        word: decision.targetWord,
        eventId: crypto.randomUUID(),
        operation: null,
        recoveryRequested: false,
        grace: null,
        deadline: null,
        requestWaitStartedAt: null,
        startedAt: performance.now(),
      };
      this.inquiries.push(inquiry);
      this.trace('inquiry_detected', inquiry);
      this.callbacks.status({ word: inquiry.word, status: 'pending' });
      // A final ASR frame may arrive just after turnComplete (Google does not order them).
      if (this.completedAt !== null && Date.now() - this.completedAt < TRANSCRIPT_WAIT_MS)
        this.schedule(inquiry);
    }
    for (const tool of [...this.pending.values()]) this.resolve(tool);
  }
  public assistantStarted(): void {
    this.busy = true;
    this.completedAt = null;
    for (const inquiry of this.inquiries) {
      if (inquiry.grace) clearTimeout(inquiry.grace);
      inquiry.grace = null;
    }
  }
  public turnComplete(): void {
    this.busy = false;
    this.completedAt = Date.now();
    for (const inquiry of this.inquiries) this.schedule(inquiry);
  }
  public receiveTool(id: string, args: unknown): void {
    if (!this.active) return;
    this.trace('tool_received', null);
    const cached = this.results.get(id);
    if (cached) {
      this.callbacks.reply(id, cached);
      return;
    }
    if (this.pending.has(id)) return;
    if (this.pending.size >= 20) {
      this.finish(id, { saved: false, reason: 'capture_budget_exceeded' });
      return;
    }
    const parsed = saveVocabularyToolArgsSchema.safeParse(args);
    if (!parsed.success) {
      this.trace('tool_rejected', null, 'invalid_arguments');
      this.finish(id, { saved: false, reason: 'invalid_tool_arguments' });
      return;
    }
    const tool: PendingTool = {
      id,
      args,
      timer: setTimeout(() => {
        if (!this.active || !this.pending.has(id)) return;
        this.pending.delete(id);
        this.trace('tool_rejected', null, 'transcript_timeout');
        this.finish(id, { saved: false, reason: 'transcript_unavailable' });
        this.callbacks.status({ word: parsed.data.word, status: 'failed' });
      }, TRANSCRIPT_WAIT_MS),
    };
    this.pending.set(id, tool);
    this.resolve(tool);
  }
  private resolve(tool: PendingTool): void {
    const parsed = saveVocabularyToolArgsSchema.safeParse(tool.args);
    if (!parsed.success) return;
    const source = normalizeVocabularyQuestion(parsed.data.source_excerpt);
    const context = [...this.contexts]
      .reverse()
      .find(
        (turns) => normalizeVocabularyQuestion(turns.at(-1)?.text.slice(0, 500) ?? '') === source,
      );
    if (!context) {
      this.trace('tool_waiting', null, 'source_unmatched');
      return; // Keep the tool pending until its own transcript, not the latest unrelated turn.
    }
    clearTimeout(tool.timer);
    this.pending.delete(tool.id);
    const validation = validateSaveVocabularyToolCall(tool.args, context);
    if (!validation.allowed) {
      this.trace('tool_rejected', null, 'validation_rejected');
      this.finish(tool.id, { saved: false, reason: validation.reason });
      if (validation.requiresClarification) this.callbacks.clarify(validation.reason);
      return;
    }
    const inquiry = this.inquiries.find((item) => item.context === context);
    if (!inquiry || !validation.sanitized.meaning_vi) {
      this.trace('tool_rejected', inquiry ?? null, 'missing_meaning');
      this.finish(tool.id, { saved: false, reason: 'missing_meaning' });
      return;
    }
    const epoch = this.epoch;
    if (!inquiry.operation) {
      this.trace('persistence_started', inquiry);
      this.clearTimers(inquiry);
      if (this.recovering === inquiry) this.recovering = null;
      // Every tool ID for this question joins the same operation and uses one event ID.
      inquiry.operation = Promise.resolve()
        .then(() =>
          this.active && this.epoch === epoch
            ? this.callbacks.save({ event_id: inquiry.eventId, ...validation.sanitized })
            : { ok: false },
        )
        .then((result) => ({
          saved: result.ok,
          ...(!result.ok ? { reason: 'persistence_failed' } : {}),
        }))
        .catch(() => ({ saved: false, reason: 'persistence_failed' }));
      void inquiry.operation.then((result) => {
        if (this.active && this.epoch === epoch) {
          this.trace(
            result.saved ? 'persistence_saved' : 'persistence_failed',
            inquiry,
            result.saved ? 'none' : 'persistence_failed',
          );
          this.callbacks.status({ word: inquiry.word, status: result.saved ? 'saved' : 'failed' });
        }
      });
    }
    void inquiry.operation.then((result) => {
      if (this.active && this.epoch === epoch) this.finish(tool.id, result);
    });
  }
  private finish(id: string, result: ToolResult): void {
    if (this.results.size >= 100) {
      const first = this.results.keys().next().value;
      if (first) this.results.delete(first);
    }
    this.results.set(id, result);
    this.callbacks.reply(id, result);
  }
  private schedule(inquiry: Inquiry): void {
    if (inquiry.operation || inquiry.recoveryRequested || inquiry.grace || !this.active) return;
    inquiry.grace = setTimeout(() => {
      inquiry.grace = null;
      if (!this.active || this.busy || inquiry.operation || inquiry.recoveryRequested) return;
      if (this.recovering) return; // Another completed turn will retry scheduling; no parallel AI retries.
      if (this.recoveryCount >= MAX_RECOVERIES) {
        this.trace('recovery_budget', inquiry, 'budget_exceeded');
        inquiry.recoveryRequested = true;
        this.callbacks.status({ word: inquiry.word, status: 'failed' });
        return;
      }
      inquiry.requestWaitStartedAt ??= Date.now();
      if (!this.callbacks.recover(inquiry.context.at(-1)!.text.slice(0, 500), inquiry.word)) {
        if (Date.now() - inquiry.requestWaitStartedAt < TRANSCRIPT_WAIT_MS) this.schedule(inquiry);
        else {
          inquiry.recoveryRequested = true;
          this.callbacks.status({ word: inquiry.word, status: 'failed' });
        }
        return;
      }
      inquiry.recoveryRequested = true;
      this.trace('recovery_requested', inquiry);
      this.recoveryCount++;
      this.recovering = inquiry;
      inquiry.deadline = setTimeout(() => {
        inquiry.deadline = null;
        if (!this.active || inquiry.operation) return;
        this.trace('recovery_timeout', inquiry, 'recovery_deadline');
        if (this.recovering === inquiry) this.recovering = null;
        this.callbacks.status({ word: inquiry.word, status: 'failed' });
        if (!this.busy) for (const pending of this.inquiries) this.schedule(pending);
      }, RECOVERY_DEADLINE_MS);
    }, RECOVERY_GRACE_MS);
  }
  private clearTimers(inquiry: Inquiry): void {
    if (inquiry.grace) clearTimeout(inquiry.grace);
    if (inquiry.deadline) clearTimeout(inquiry.deadline);
    inquiry.grace = inquiry.deadline = null;
  }
  private trace(
    stage: CaptureDiagnostic['stage'],
    inquiry: Inquiry | null,
    reason: CaptureDiagnostic['reason'] = 'none',
  ): void {
    this.callbacks.diagnostic?.({
      capture_id: inquiry?.eventId ?? null,
      stage,
      reason,
      path: inquiry ? (inquiry.recoveryRequested ? 'recovery' : 'direct') : 'unknown',
      elapsed_ms: inquiry
        ? Math.min(86_400_000, Math.max(0, Math.round(performance.now() - inquiry.startedAt)))
        : 0,
    });
  }
}
