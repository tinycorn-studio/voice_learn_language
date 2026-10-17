import { AppError } from '../domain/env.js';
import type { DatabaseBinding } from './d1-database.js';

/** Authenticated user limits that used to live only in per-isolate memory (`M9-02`). */
export type RateLimitScope = 'live_token' | 'translate';

export const RATE_LIMIT_MESSAGES: Record<RateLimitScope, string> = {
  live_token: 'Too many live token requests. Please wait a minute before reconnecting.',
  translate: 'Bạn đã dịch nhiều câu trong thời gian ngắn. Hãy chờ một chút rồi thử lại.',
};

export const RATE_LIMIT_MAX_PER_MINUTE: Record<RateLimitScope, number> = {
  live_token: 5,
  translate: 12,
};

export interface RateLimiter {
  consume(scope: RateLimitScope, userId: string, nowMs: number, maxPerMinute: number): Promise<void>;
}

export function createRateLimitError(scope: RateLimitScope): AppError {
  return new AppError({
    code: 'RATE_LIMITED',
    message: RATE_LIMIT_MESSAGES[scope],
    status: 429,
    retryable: true,
  });
}

/**
 * Fixed 60-second windows persisted in D1 so every isolate shares one counter.
 * Compared with the previous sliding window this can allow a burst across a window
 * boundary; rate limits here guard abuse, not billing, and the fixed window costs one
 * D1 round trip. Rejected calls keep counting until the window rolls over.
 */
export class D1RateLimiter implements RateLimiter {
  public constructor(private readonly db: DatabaseBinding) {}

  public async consume(
    scope: RateLimitScope,
    userId: string,
    nowMs: number,
    maxPerMinute: number,
  ): Promise<void> {
    const windowStart = Math.floor(nowMs / 60_000) * 60_000;
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO rate_limit_windows(scope,user_id,window_start,count) VALUES(?,?,?,1)
          ON CONFLICT(scope,user_id,window_start) DO UPDATE SET count=count+1`,
        )
        .bind(scope, userId, windowStart),
      this.db
        .prepare(
          'SELECT count FROM rate_limit_windows WHERE scope=? AND user_id=? AND window_start=?',
        )
        .bind(scope, userId, windowStart),
    ]);
    const row = results[1]?.results?.[0] as { count?: unknown } | undefined;
    const count = Number(row?.count);
    if (!Number.isFinite(count)) throw new Error('Rate limit counter unavailable');
    if (count > maxPerMinute) throw createRateLimitError(scope);
  }
}

/** Called from the minute Cron; keeps the table bounded without touching active windows. */
export async function cleanupRateLimitWindows(
  db: DatabaseBinding,
  beforeMs: number,
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM rate_limit_windows WHERE window_start < ?')
    .bind(beforeMs)
    .run();
  return result.meta.changes;
}
