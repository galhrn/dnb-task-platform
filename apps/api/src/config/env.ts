import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Works whether the process is started from the repo root or from apps/api.
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')], quiet: true });

const port = z.coerce.number().int().positive().max(65535);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: port.default(3000),
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: port.default(5432),
  POSTGRES_USER: z.string().min(1).default('taskuser'),
  POSTGRES_PASSWORD: z.string().min(1).default('taskpass'),
  POSTGRES_DB: z.string().min(1).default('taskplatform'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * process.env is read once, here, and validated. Nothing else in the codebase
 * touches process.env - so a missing variable fails at boot with a readable
 * message rather than as `undefined` somewhere deep in a query.
 */
function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env = loadEnv();
