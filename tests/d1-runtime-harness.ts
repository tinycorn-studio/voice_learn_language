import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { DatabaseBinding } from '../apps/worker/src/adapters/d1-database.js';

/** Real workerd SQLite/D1 binding, isolated in memory; no Cloudflare network account. */
export async function createD1RuntimeHarness() {
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: '2026-07-01',
    script: 'export default { fetch() { return new Response("synthetic"); } };',
    d1Databases: ['DB'],
  });
  try {
    const binding = await runtime.getD1Database('DB');
    // D1 exec splits on newlines. Split this controlled DDL only at top-level CREATE/INSERT,
    // preserving trigger BEGIN/END bodies; data imports use the dedicated migration tool.
    const statements = readFileSync('apps/worker/migrations/0001_d1_primary.sql', 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?=CREATE|INSERT|$)/i)
      .map((sql) => sql.trim())
      .filter(Boolean);
    await binding.batch(statements.map((sql) => binding.prepare(sql)));
    const db: DatabaseBinding = binding;
    return { db, dispose: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
