import type { Express } from 'express';
import type { DataSource } from 'typeorm';

import { ChangeTaskStatusUseCase } from './application/use-cases/change-task-status';
import { CloseTaskUseCase } from './application/use-cases/close-task';
import { CreateTaskUseCase } from './application/use-cases/create-task';
import { GetTaskUseCase } from './application/use-cases/get-task';
import { GetUserTasksUseCase } from './application/use-cases/get-user-tasks';
import { ListTaskTypesUseCase } from './application/use-cases/list-task-types';
import { ListUsersUseCase } from './application/use-cases/list-users';
import { TASK_TYPE_DEFINITIONS } from './domain/task-types/index';
import { TaskTypeRegistry } from './domain/task-types/registry';
import {
  repositoriesFor,
  TypeOrmUnitOfWork,
} from './infrastructure/db/repositories/typeorm-unit-of-work';
import { createApp, type UseCases } from './interfaces/http/app';

/**
 * The composition root. Every concrete choice in the system is made here, once, and the
 * whole graph reads top to bottom in one screen.
 *
 * This is ADR-001 made visible. NestJS would assemble the same graph with less code, but
 * it would assemble it somewhere you cannot point at - and the thing being evaluated is
 * exactly this wiring. No decorators, no container, no reflection, no registration order
 * to reason about: just constructors called in dependency order.
 *
 * Note which use cases get what. Writes take the UnitOfWork because they must be atomic;
 * reads take repositories directly because a transaction around one query buys nothing;
 * `listTaskTypes` takes only the registry, because task types live in code and never
 * touch the database at all.
 */
export function buildUseCases(dataSource: DataSource): UseCases {
  const registry = new TaskTypeRegistry(TASK_TYPE_DEFINITIONS);

  const unitOfWork = new TypeOrmUnitOfWork(dataSource);
  const { tasks, users } = repositoriesFor(dataSource.manager);

  return {
    createTask: new CreateTaskUseCase(registry, unitOfWork),
    changeTaskStatus: new ChangeTaskStatusUseCase(registry, unitOfWork),
    closeTask: new CloseTaskUseCase(registry, unitOfWork),

    getTask: new GetTaskUseCase(tasks),
    getUserTasks: new GetUserTasksUseCase(tasks, users),
    listUsers: new ListUsersUseCase(users),

    listTaskTypes: new ListTaskTypesUseCase(registry),
  };
}

export function buildApp(dataSource: DataSource): Express {
  return createApp({ dataSource, useCases: buildUseCases(dataSource) });
}
