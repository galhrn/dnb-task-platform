import type { Server } from 'node:http';

import { env } from './config/env';
import { buildApp } from './composition-root';
import { AppDataSource } from './infrastructure/db/data-source';

async function bootstrap(): Promise<void> {
  try {
    await AppDataSource.initialize();
    console.log(`[db]  connected to ${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`);
  } catch (error) {
    // Deliberate for local development: the HTTP server stays inspectable with no
    // container running, and /api/health reports 503 degraded until the database is
    // back. A production bootstrap would exit non-zero here instead.
    console.warn('[db]  unavailable - starting anyway, /api/health will report degraded');
    console.warn(`[db]  ${describeError(error)}`);
  }

  const app = buildApp(AppDataSource);
  const server = app.listen(env.API_PORT, () => {
    console.log(`[api] listening on http://localhost:${env.API_PORT}/api/health (${env.NODE_ENV})`);
  });

  registerShutdown(server);
}

/** node's connection errors arrive as an AggregateError whose own message is empty. */
function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map(describeError).join('; ');
  }

  if (error instanceof Error) {
    return error.message || error.name;
  }

  return String(error);
}

function registerShutdown(server: Server): void {
  const shutdown = (signal: string): void => {
    console.log(`[api] ${signal} received, shutting down`);

    server.close(() => {
      void (AppDataSource.isInitialized ? AppDataSource.destroy() : Promise.resolve()).finally(() =>
        process.exit(0),
      );
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void bootstrap().catch((error: unknown) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
