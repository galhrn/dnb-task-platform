import express, { type Express } from 'express';
import type { DataSource } from 'typeorm';

import { createHealthRouter } from './routes/health.routes';

/**
 * Everything the HTTP layer needs, passed in. The app builds nothing itself, so
 * tests can hand it doubles and the composition root stays the only place where
 * concrete implementations are chosen (ADR-001).
 */
export interface AppDependencies {
  dataSource: DataSource;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  // M4 mounts tasks / users / task-types routers here, then the error middleware last.
  app.use('/api', createHealthRouter(deps.dataSource));

  return app;
}
