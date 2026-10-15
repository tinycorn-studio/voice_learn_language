import { z } from 'zod';

/** Metadata only: never pass a question, term, tool arguments or exception into diagnostics. */
export const captureDiagnosticSchema = z.object({
  capture_id: z.string().uuid().nullable(),
  stage: z.enum([
    'intent_ignored',
    'intent_clarify',
    'inquiry_detected',
    'tool_received',
    'tool_waiting',
    'tool_rejected',
    'persistence_started',
    'persistence_saved',
    'persistence_failed',
    'recovery_requested',
    'recovery_timeout',
    'recovery_budget',
  ]),
  reason: z.enum([
    'none',
    'invalid_arguments',
    'source_unmatched',
    'validation_rejected',
    'missing_meaning',
    'persistence_failed',
    'transcript_timeout',
    'recovery_deadline',
    'budget_exceeded',
    'transport_unavailable',
  ]),
  path: z.enum(['direct', 'recovery', 'unknown']),
  elapsed_ms: z.number().finite().min(0).max(86_400_000),
  persistence_duration_ms: z.number().finite().min(0).max(86_400_000).optional(),
});
export type CaptureDiagnostic = z.infer<typeof captureDiagnosticSchema>;
