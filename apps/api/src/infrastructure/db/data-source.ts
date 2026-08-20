import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { env } from '../../config/env';

/**
 * The single TypeORM DataSource.
 *
 * `synchronize` is off, permanently (section 10): the schema is owned by hand-written,
 * committed migrations. Entities and migrations are registered explicitly rather than
 * by glob - the list is short, it survives any change of runner or output directory,
 * and an unregistered file fails loudly instead of being silently skipped.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  username: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,

  synchronize: false,
  logging: env.NODE_ENV === 'development' ? ['error', 'warn', 'migration'] : ['error'],

  // M2 registers TaskEntity, TaskTransitionEntity, UserEntity and InitialSchema here.
  entities: [],
  migrations: [],
});
