import { z } from 'zod';
import { vocabularyItemSchema } from './api.js';
import { fsrsCardSchema } from '../srs/fsrs-engine.js';

export const MIRROR_IDS = {
  Words: 'word_id',
  Cards: 'card_id',
  Reviews: 'review_id',
  Events: 'event_id',
  Settings: 'user_id',
  Users: 'user_id',
  DailyDispatchLog: 'dispatch_id',
} as const;
export const mirrorTabSchema = z.enum([
  'Words',
  'Cards',
  'Reviews',
  'Events',
  'Settings',
  'Users',
  'DailyDispatchLog',
]);
export const mirrorEntitySchema = z
  .object({
    tab: mirrorTabSchema,
    id: z.string().min(1).max(160),
    version: z.number().int().nonnegative(),
    row: z.record(z.unknown()),
  })
  .superRefine((entity, ctx) => {
    const row = entity.row;
    if (
      row[MIRROR_IDS[entity.tab]] !== entity.id ||
      !/^telegram:\d+$/.test(String(row['user_id'] ?? ''))
    )
      ctx.addIssue({ code: 'custom', message: 'Mirror entity identity mismatch' });
    if (
      entity.tab === 'Words' &&
      (!vocabularyItemSchema.safeParse(row).success || row['version'] !== entity.version)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid Word snapshot' });
    if (
      entity.tab === 'Cards' &&
      (!fsrsCardSchema.safeParse(row).success || row['row_version'] !== entity.version)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid Card snapshot' });
    for (const value of Object.values(row)) {
      if (!(
        value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 48000)
      ))
        ctx.addIssue({ code: 'custom', message: 'Invalid mirror cell' });
    }
  });
export const mirrorJobSchema = z.object({
  event_id: z.string().min(1).max(160),
  entities: z.array(mirrorEntitySchema).min(1).max(10),
});
export const mirrorBatchSchema = z.object({
  epoch: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  jobs: z.array(mirrorJobSchema).min(1).max(3),
});
export type MirrorEntity = z.infer<typeof mirrorEntitySchema>;

/** Stable snapshot comparison independent of object property insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`)
      .join(',')}}`;
  }
  const scalar = JSON.stringify(value);
  if (scalar === undefined) throw new TypeError('Value is not JSON');
  return scalar;
}
