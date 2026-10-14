import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { z } from 'zod';
import { AppError } from '../domain/env.js';

/** Minimal injectable binding: domain and frontend do not depend on Cloudflare runtime. */
export type DatabaseBinding = Pick<D1Database, 'prepare' | 'batch'>;
export type Statement = D1PreparedStatement;

export async function requireD1Schema(db: DatabaseBinding): Promise<void> {
  const row = await db.prepare("SELECT value FROM system_state WHERE key='schema_version'").first();
  if (!z.object({ value: z.literal('1') }).safeParse(row).success)
    throw new AppError({
      code: 'UNAVAILABLE',
      message: 'Database schema is not ready',
      status: 503,
    });
}

/** This statement is part of the mutation batch, so maintenance cannot race a commit. */
export function writeGuard(
  db: DatabaseBinding,
  guardId: string,
  condition = '1=1',
  bindings: unknown[] = [],
): Statement {
  return db
    .prepare(
      `INSERT INTO mutation_guards(guard_id,valid)
    SELECT ?, CASE WHEN (SELECT value FROM system_state WHERE key='writes_enabled')='true'
    AND (${condition}) THEN 1 ELSE 0 END`,
    )
    .bind(guardId, ...bindings);
}
export function clearGuard(db: DatabaseBinding, guardId: string): Statement {
  return db.prepare('DELETE FROM mutation_guards WHERE guard_id=?').bind(guardId);
}
