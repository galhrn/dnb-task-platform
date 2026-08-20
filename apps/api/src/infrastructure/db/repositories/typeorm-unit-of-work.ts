import type { DataSource, EntityManager } from 'typeorm';

import type { Repositories, UnitOfWork } from '../../../application/ports/unit-of-work';
import { TypeOrmTaskRepository } from './typeorm-task.repository';
import { TypeOrmUserRepository } from './typeorm-user.repository';

/** Repositories bound to one entity manager - transactional or not, same classes. */
export function repositoriesFor(manager: EntityManager): Repositories {
  return {
    tasks: new TypeOrmTaskRepository(manager),
    users: new TypeOrmUserRepository(manager),
  };
}

/**
 * One database transaction per unit of work. If `work` throws - including when the
 * workflow engine rejects a move - TypeORM rolls back, so a refused transition can never
 * leave a history row behind.
 */
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  async runInTransaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => work(repositoriesFor(manager)));
  }
}
