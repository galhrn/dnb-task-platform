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

  /**
   * `GET /api/users` - the seeded users, for assignee pickers.
   *
   * @returns `200` with the users, by name
   */
  router.get(
    '/users',
    asyncRoute(async (_req, res) => {
      const users = await deps.listUsers.execute();

      res.status(200).json(users.map(toUserDto));
    }),
  );

  /**
   * `GET /api/users/:id/tasks` - the tasks a user currently holds.
   *
   * @query `state` - optional, `OPEN` or `CLOSED`. Absent means both (ADR-012); an
   *   unrecognised value is rejected rather than ignored.
   * @returns `200` with the tasks, newest first
   * @returns `400` if the id is not a uuid or `state` is unrecognised, `404` if no such user
   */
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
