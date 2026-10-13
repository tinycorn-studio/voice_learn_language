import { AppError, type WorkerEnv } from '../domain/env.js';
import { GasRepositoryAdapter } from './gas-client.js';
import { requireD1Schema } from './d1-database.js';

/** All HTTP, Telegram and Cron entry points must select the same authority. */
export async function createRepositories(env: WorkerEnv, fetchFn: typeof fetch) {
  if (env.DATA_BACKEND === 'd1') {
    if (!env.DB)
      throw new AppError({ code: 'UNAVAILABLE', message: 'D1 binding is missing', status: 503 });
    await requireD1Schema(env.DB);
    // M7-04 supplies adapters before D1 can be enabled: never silently write to GAS.
    throw new AppError({
      code: 'UNAVAILABLE',
      message: 'D1 repositories are not enabled yet',
      status: 503,
    });
  }
  if (env.DATA_BACKEND !== undefined && env.DATA_BACKEND !== 'gas')
    throw new AppError({ code: 'UNAVAILABLE', message: 'Invalid data backend', status: 503 });
  const repository = new GasRepositoryAdapter(env.GAS_EXEC_URL, env.GAS_SHARED_SECRET, fetchFn);
  return { vocabulary: repository, review: repository };
}
