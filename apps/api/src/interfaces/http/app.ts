import express, { type Express } from 'express';
import type { DataSource } from 'typeorm';

import type { ChangeTaskStatusUseCase } from '../../application/use-cases/change-task-status';
import type { CloseTaskUseCase } from '../../application/use-cases/close-task';
import type { CreateTaskUseCase } from '../../application/use-cases/create-task';
import type { GetTaskUseCase } from '../../application/use-cases/get-task';
import type { GetUserTasksUseCase } from '../../application/use-cases/get-user-tasks';
import type { ListTaskTypesUseCase } from '../../application/use-cases/list-task-types';
import type { ListUsersUseCase } from '../../application/use-cases/list-users';
import { RouteNotFoundError } from './errors';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { createHealthRouter } from './routes/health.routes';
import { createTaskTypesRouter } from './routes/task-types.routes';
import { createTasksRouter } from './routes/tasks.routes';
import { createUsersRouter } from './routes/users.routes';

/**
 * What the HTTP layer needs, declared BY the HTTP layer. The composition root satisfies
 * this interface; nothing here knows how a use case was built or what it talks to.
 */
export interface UseCases {
  readonly createTask: CreateTaskUseCase;
  readonly getTask: GetTaskUseCase;
  readonly changeTaskStatus: ChangeTaskStatusUseCase;
  readonly closeTask: CloseTaskUseCase;
  readonly getUserTasks: GetUserTasksUseCase;
  readonly listUsers: ListUsersUseCase;
  readonly listTaskTypes: ListTaskTypesUseCase;
}

export interface AppDependencies {
  /** Health only. No route reads or writes through it. */
  readonly dataSource: DataSource;
  readonly useCases: UseCases;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createHealthRouter(deps.dataSource));
  app.use('/api', createTaskTypesRouter(deps.useCases.listTaskTypes));
  app.use('/api', createTasksRouter(deps.useCases));
  app.use('/api', createUsersRouter(deps.useCases));

  // Order matters: an unmatched route becomes an error, and the error middleware is last
  // so that everything - including a malformed JSON body - leaves through one envelope.
  app.use((req, _res, next) => {
    next(new RouteNotFoundError(req.method, req.path));
  });
  app.use(errorHandler());

  return app;
}
