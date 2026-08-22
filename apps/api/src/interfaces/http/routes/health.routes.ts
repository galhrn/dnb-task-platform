import type { HealthResponse } from '@task-platform/contracts';
import { Router } from 'express';
import type { DataSource } from 'typeorm';

async function probeDatabase(dataSource: DataSource): Promise<HealthResponse['database']> {
  if (!dataSource.isInitialized) {
    return 'down';
  }

  try {
    await dataSource.query('SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}

/**
 * `GET /api/health` - liveness plus a live database probe.
 *
 * @returns `200` `{ status: 'ok', database: 'up' }` when the database answers
 * @returns `503` `{ status: 'degraded', database: 'down' }` when it does not - a health
 *   check that reports "ok" while its only dependency is down is worse than none at all
 */
export function createHealthRouter(dataSource: DataSource): Router {
  const router = Router();

  // `probeDatabase` is total - it resolves 'down' rather than rejecting - so this
  // handler needs no error plumbing. M4 introduces the async wrapper for the routes
  // that can actually throw.
  router.get('/health', async (_req, res) => {
    const database = await probeDatabase(dataSource);

    const body: HealthResponse = {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
    };

    res.status(database === 'up' ? 200 : 503).json(body);
  });

  return router;
}
