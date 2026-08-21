import { Router } from 'express';

import type { ChangeTaskStatusUseCase } from '../../../application/use-cases/change-task-status';
import type { CloseTaskUseCase } from '../../../application/use-cases/close-task';
import type { CreateTaskUseCase } from '../../../application/use-cases/create-task';
import type { GetTaskUseCase } from '../../../application/use-cases/get-task';
import {
  ChangeTaskStatusBodySchema,
  CloseTaskBodySchema,
  CreateTaskBodySchema,
  parseRequest,
  TaskIdParamsSchema,
} from '../dto/request-schemas';
import { toTaskDto, toTaskWithHistoryDto } from '../dto/response-mappers';
import { asyncRoute } from '../middleware/async-route';

export interface TasksRouterDependencies {
  readonly createTask: CreateTaskUseCase;
  readonly getTask: GetTaskUseCase;
  readonly changeTaskStatus: ChangeTaskStatusUseCase;
  readonly closeTask: CloseTaskUseCase;
}

/**
 * Every handler is the same four lines: parse, call, map, respond. There is no branching
 * on task type, no error construction, and no business rule - if one appeared here it
 * would be in the wrong layer, and that is easy to see precisely because the handlers are
 * this dull.
 */
export function createTasksRouter(deps: TasksRouterDependencies): Router {
  const router = Router();

  router.post(
    '/tasks',
    asyncRoute(async (req, res) => {
      const body = parseRequest(CreateTaskBodySchema, req.body, 'body');
      const task = await deps.createTask.execute(body);

      res.status(201).json(toTaskDto(task));
    }),
  );

  router.get(
    '/tasks/:id',
    asyncRoute(async (req, res) => {
      const { id } = parseRequest(TaskIdParamsSchema, req.params, 'params');
      const found = await deps.getTask.execute(id);

      res.status(200).json(toTaskWithHistoryDto(found));
    }),
  );

  // One endpoint for both directions. The caller says where the task should end up; which
  // direction that is gets derived, never declared (section 9).
  router.post(
    '/tasks/:id/transitions',
    asyncRoute(async (req, res) => {
      const { id } = parseRequest(TaskIdParamsSchema, req.params, 'params');
      const body = parseRequest(ChangeTaskStatusBodySchema, req.body, 'body');

      const task = await deps.changeTaskStatus.execute({ taskId: id, ...body });

      res.status(200).json(toTaskDto(task));
    }),
  );

  // Separate from /transitions because closing is a state change, not a status change -
  // which is also why this body carries no assignee (ADR-011).
  router.post(
    '/tasks/:id/close',
    asyncRoute(async (req, res) => {
      const { id } = parseRequest(TaskIdParamsSchema, req.params, 'params');
      const body = parseRequest(CloseTaskBodySchema, req.body, 'body');

      const task = await deps.closeTask.execute({ taskId: id, ...body });

      res.status(200).json(toTaskDto(task));
    }),
  );

  return router;
}
