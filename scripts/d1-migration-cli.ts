import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Miniflare } from 'miniflare';
import { z } from 'zod';
import { canonicalJson } from '@voice-chat/shared';
import { signGasPayload } from '../apps/worker/src/adapters/gas-client.js';
import {
  exportGasSnapshot,
  planMigration,
  importSnapshot,
  verifyImport,
  exportD1Snapshot,
  restoreGasSnapshot,
  type GasOperatorCall,
} from './lib/d1-migration.js';
import { createD1ApiBinding } from './lib/d1-api-binding.js';
import type { DatabaseBinding } from '../apps/worker/src/adapters/d1-database.js';

const args = process.argv.slice(2);
const mode = args[0];
function option(name: string, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? '');
}
function requireOption(name: string) {
  const value = option(name);
  if (!value) throw new Error('Missing required option');
  return value;
}
function artifactPath(file: string) {
  const root = resolve('.artifacts');
  const path = resolve(file);
  if (!path.startsWith(root + sep)) throw new Error('Private output must be under .artifacts');
  mkdirSync(resolve(path, '..'), { recursive: true });
  return path;
}
function save(file: string, value: unknown) {
  writeFileSync(artifactPath(file), canonicalJson(value) + '\n', { mode: 0o600 });
}
function applyRequired() {
  if (!args.includes('--apply')) throw new Error('Mutating command requires --apply');
}
function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required environment variable');
  return value;
}
function gasCall(): GasOperatorCall {
  const url = env('GAS_EXEC_URL');
  if (!url.startsWith('https://script.google.com/') && !url.startsWith('http://127.0.0.1:'))
    throw new Error('Unsupported GAS endpoint');
  return async (action, data) => {
    const payload = canonicalJson({
      action,
      event_id: `migration_${crypto.randomUUID()}`,
      issued_at: new Date().toISOString(),
      user_id: `telegram:${env('OWNER_TELEGRAM_ID')}`,
      request_id: crypto.randomUUID(),
      data,
    });
    if (payload.length > 60000) throw new Error('Migration body too large');
    const signature = await signGasPayload(payload, env('GAS_SHARED_SECRET'));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload, signature }),
      signal: AbortSignal.timeout(30000),
    });
    const parsed = z
      .object({ ok: z.literal(true), data: z.unknown() })
      .parse((await response.json()) as unknown);
    if (!response.ok) throw new Error('GAS operation failed');
    return parsed.data;
  };
}
async function main() {
  if (!mode || mode === 'help') {
    console.info(
      'Modes: gas-freeze, gas-unfreeze, gas-export, dry-run, d1-import, d1-verify, d1-export, gas-restore. See docs/29_D1_MIGRATION_RUNBOOK.md. Mutations require --apply; private outputs must be in .artifacts.',
    );
    return;
  }
  const output = option('output', `.artifacts/M7-07/${mode}.json`);
  if (mode === 'gas-freeze' || mode === 'gas-unfreeze') {
    applyRequired();
    save(
      output,
      await gasCall()('migration.freeze', {
        freeze: mode === 'gas-freeze',
        ...(mode === 'gas-unfreeze' ? { freeze_id: requireOption('freeze-id') } : {}),
      }),
    );
    return;
  }
  if (mode === 'gas-export') {
    save(
      output,
      await exportGasSnapshot(
        gasCall(),
        `telegram:${env('OWNER_TELEGRAM_ID')}`,
        requireOption('freeze-id'),
      ),
    );
    return;
  }
  if (mode === 'gas-restore') {
    applyRequired();
    await restoreGasSnapshot(
      gasCall(),
      JSON.parse(readFileSync(requireOption('input'), 'utf8')) as unknown,
      requireOption('freeze-id'),
    );
    return;
  }
  const plan =
    mode === 'd1-export'
      ? null
      : await planMigration(
          JSON.parse(readFileSync(requireOption('input'), 'utf8')) as unknown,
          args.includes('--materialize-legacy-cards'),
        );
  if (plan)
    save(output, {
      source_checksum: plan.snapshot.sha256,
      counts: Object.fromEntries(
        Object.entries(plan.records).map(([tab, rows]) => [tab, rows.length]),
      ),
      quarantine: plan.quarantine,
      generated_cards: plan.generated_cards,
    });
  if (mode === 'dry-run') {
    if (plan!.quarantine.length) process.exitCode = 2;
    return;
  }
  if (!['d1-import', 'd1-verify', 'd1-export'].includes(mode)) throw new Error('Unsupported mode');
  let db: DatabaseBinding;
  let runtime: Miniflare | undefined;
  try {
    if (args.includes('--remote')) {
      db = createD1ApiBinding({
        accountId: env('CLOUDFLARE_ACCOUNT_ID'),
        databaseId: requireOption('database-id'),
        token: env('CLOUDFLARE_API_TOKEN'),
      });
    } else if (args.includes('--local')) {
      runtime = new Miniflare({
        modules: true,
        compatibilityDate: '2026-07-01',
        script: 'export default { fetch() { return new Response("local migration"); } };',
        d1Databases: ['DB'],
        d1Persist: artifactPath(option('persist', '.artifacts/M7-07/local-db')),
      });
      db = await runtime.getD1Database('DB');
      const exists = await db
        .prepare("SELECT name FROM sqlite_master WHERE name='system_state'")
        .first();
      if (!exists) {
        if (mode !== 'd1-import') throw new Error('Local schema not initialized');
        applyRequired();
        for (const file of readdirSync('apps/worker/migrations')
          .filter((f) => f.endsWith('.sql'))
          .sort()) {
          const sql = readFileSync(`apps/worker/migrations/${file}`, 'utf8')
            .replace(/^--.*$/gm, '')
            .split(/;\s*(?=CREATE|INSERT|ALTER|UPDATE|DROP|$)/i)
            .map((s) => s.trim())
            .filter(Boolean);
          await db.batch(sql.map((s) => db.prepare(s)));
        }
        await db.prepare("UPDATE system_state SET value='false' WHERE key='writes_enabled'").run();
      }
    } else throw new Error('Choose --local or --remote explicitly');
    if (mode === 'd1-import') {
      applyRequired();
      await importSnapshot(db, plan!, requireOption('epoch'));
      save(output, await verifyImport(db, plan!));
    } else if (mode === 'd1-verify') {
      const report = await verifyImport(db, plan!);
      save(output, report);
      if (!report.ok) process.exitCode = 2;
    } else
      save(
        output,
        await exportD1Snapshot(
          db,
          env('OWNER_TELEGRAM_ID').startsWith('telegram:')
            ? env('OWNER_TELEGRAM_ID')
            : `telegram:${env('OWNER_TELEGRAM_ID')}`,
          requireOption('freeze-id'),
          requireOption('frozen-at'),
        ),
      );
  } finally {
    await runtime?.dispose();
  }
}
void main()
  .then(() => console.info('Migration command finished; inspect private report.'))
  .catch(() => {
    console.error(
      'Migration command failed. Keep source/target writes frozen; verify options, credentials and private report. No data or secrets printed.',
    );
    process.exitCode = 1;
  });
