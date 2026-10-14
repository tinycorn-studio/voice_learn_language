import { z } from 'zod';
import type { DatabaseBinding, Statement } from '../../apps/worker/src/adapters/d1-database.js';

/** Used by offline migration tools only. Prepared values never enter terminal output. */
export function renderSql(sql: string, values: unknown[]): string {
  let index = 0;
  const result = sql.replace(/'(?:''|[^'])*'|\?/g, (token) => {
    if (token !== '?') return token;
    if (index >= values.length) throw new Error('Missing SQL binding');
    const value = values[index++];
    if (value === null) return 'NULL';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    throw new Error('Unsupported SQL binding');
  });
  if (index !== values.length) throw new Error('Extra SQL binding');
  return result;
}
const responseSchema = z.object({
  success: z.literal(true),
  result: z.array(
    z.object({
      success: z.literal(true).default(true),
      results: z.array(z.record(z.unknown())).default([]),
      meta: z.record(z.unknown()).default({}),
    }),
  ),
});

/** Cloudflare REST batch API; M7-08 must prove transaction rollback on the real target. */
export function createD1ApiBinding(params: {
  accountId: string;
  databaseId: string;
  token: string;
  fetchFn?: typeof fetch;
}): DatabaseBinding {
  z.string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(params.accountId);
  z.string().uuid().parse(params.databaseId);
  if (!params.token) throw new Error('Missing Cloudflare credential');
  const queries = new WeakMap<object, { sql: string; values: unknown[] }>();
  async function request(batch: { sql: string; values: unknown[] }[]) {
    const response = await (params.fetchFn ?? fetch)(
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId}/d1/database/${params.databaseId}/query`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${params.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ batch: batch.map((q) => ({ sql: renderSql(q.sql, q.values) })) }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error('Cloudflare D1 API failed');
    const body: unknown = await response.json();
    const result = responseSchema.parse(body).result;
    if (result.length !== batch.length) throw new Error('D1 batch result count mismatch');
    return result;
  }
  function prepare(sql: string, values: unknown[] = []): Statement {
    const statement = {
      bind: (...bindings: unknown[]) => prepare(sql, bindings),
      all: async () => (await request([{ sql, values }]))[0]!,
      run: async () => (await request([{ sql, values }]))[0]!,
      first: async (column?: string) => {
        const row = (await request([{ sql, values }]))[0]?.results[0];
        return row ? (column ? (row[column] ?? null) : row) : null;
      },
    };
    queries.set(statement, { sql, values });
    // Operator adapter implements exactly prepare/bind/first/all/run/batch used by the
    // migration library. Cloudflare-only raw()/Worker methods are never invoked here.
    return statement as unknown as Statement;
  }
  return {
    prepare,
    batch: async (statements: Statement[]) => {
      const batch = statements.map((statement) => {
        const value = queries.get(statement);
        if (!value) throw new Error('Foreign statement');
        return value;
      });
      return await request(batch);
    },
  } as unknown as DatabaseBinding;
}
