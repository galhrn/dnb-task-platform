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

  /**
   * `POST /api/tasks` - create a task at its type's first status.
   *
   * @body `{ type, assignedUserId, actorUserId }`
   * @returns `201` with the task
   * @returns `400` if the body cannot be parsed, `404` for an unknown type or user
   */
  router.post(
    '/tasks',
    asyncRoute(async (req, res) => {
      const body = parseRequest(CreateTaskBodySchema, req.body, 'body');
      const task = await deps.createTask.execute(body);

      res.status(201).json(toTaskDto(task));
    }),
  );

  /**
   * `GET /api/tasks/:id` - the task with its full transition history.
   *
   * @returns `200` with the task and its history, oldest first
   * @returns `400` if the id is not a uuid, `404` if no such task
   */
  router.get(
    '/tasks/:id',
    asyncRoute(async (req, res) => {
      const { id } = parseRequest(TaskIdParamsSchema, req.params, 'params');
      const found = await deps.getTask.execute(id);

      res.status(200).json(toTaskWithHistoryDto(found));
    }),
  );

  /**
   * `POST /api/tasks/:id/transitions` - move the task, forwards or backwards.
   *
   * One endpoint for both: the caller says where the task should end up, and which
   * direction that is gets derived rather than declared (section 9).
   *
   * @body `{ toStatus, assignedUserId, actorUserId, data?, expectedVersion? }`
   * @returns `200` with the task as it now stands
   * @returns `400` unparseable, `404` unknown task or user, `422` the target status's data
   *   requirements are unmet, `409` illegal move / closed task / version conflict
   */
  router.post(
    '/tasks/:id/transitions',
    asyncRoute(async (req, res) => {
      const { id } = parseRequest(TaskIdParamsSchema, req.params, 'params');
      const body = parseRequest(ChangeTaskStatusBodySchema, req.body, 'body');

      const task = await deps.changeTaskStatus.execute({ taskId: id, ...body });

      res.status(200).json(toTaskDto(task));
    }),
  );

  /**
   * `POST /api/tasks/:id/close` - finish the task.
   *
   * Separate from `/transitions` because closing is a state change, not a status change -
   * which is also why this body carries no assignee (ADR-011). It does carry an actor.
   *
   * @body `{ actorUserId, expectedVersion? }`
   * @returns `200` with the closed task, still held by the same user
   * @returns `400` unparseable, `404` unknown task or actor, `409` not at the final status
   *   / already closed / version conflict
   */
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
