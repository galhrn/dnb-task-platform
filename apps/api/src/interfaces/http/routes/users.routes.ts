import { Router } from 'express';

import type { GetUserTasksUseCase } from '../../../application/use-cases/get-user-tasks';
import type { ListUsersUseCase } from '../../../application/use-cases/list-users';
import { parseRequest, UserIdParamsSchema, UserTasksQuerySchema } from '../dto/request-schemas';
import { toTaskDto, toUserDto } from '../dto/response-mappers';
import { asyncRoute } from '../middleware/async-route';

export interface UsersRouterDependencies {
  readonly listUsers: ListUsersUseCase;
  readonly getUserTasks: GetUserTasksUseCase;
}

export function createUsersRouter(deps: UsersRouterDependencies): Router {
  const router = Router();

  router.get(
    '/users',
    asyncRoute(async (_req, res) => {
      const users = await deps.listUsers.execute();

      res.status(200).json(users.map(toUserDto));
    }),
  );

  // ADR-012: everything by default, `?state=OPEN|CLOSED` narrows, anything else is a 400.
  router.get(
    '/users/:id/tasks',
    asyncRoute(async (req, res) => {
      const { id } = parseRequest(UserIdParamsSchema, req.params, 'params');
      const query = parseRequest(UserTasksQuerySchema, req.query, 'query');

      const tasks = await deps.getUserTasks.execute({ userId: id, ...query });

      res.status(200).json(tasks.map(toTaskDto));
    }),
  );

  return router;
}
