import { z } from 'zod';

/** Only bounded lifecycle measurements are exported; never accepts request or user content. */
export const startupDiagnosticSchema = z.object({
  stage: z.enum([
    'app_mounted',
    'auth_started',
    'auth_ready',
    'auth_failed',
    'voice_ready',
    'vocabulary_load_started',
    'vocabulary_load_completed',
    'vocabulary_load_failed',
    'review_load_started',
    'review_load_completed',
    'review_load_failed',
  ]),
  elapsed_ms: z.number().finite().min(0).max(86_400_000),
  duration_ms: z.number().finite().min(0).max(86_400_000).optional(),
});

export type StartupDiagnostic = z.infer<typeof startupDiagnosticSchema>;
