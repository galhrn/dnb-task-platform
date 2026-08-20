import { defineConfig } from 'vitest/config';

/**
 * Integration tests. These need `docker compose up -d` and a migrated database, which is
 * exactly why they are a separate command: `npm test` must stay runnable on a laptop with
 * no container, and the domain suite has no business waiting for Postgres.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    // One database, shared state: integration files run one after another.
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
