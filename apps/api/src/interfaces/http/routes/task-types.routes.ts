import { Router } from 'express';

import type { ListTaskTypesUseCase } from '../../../application/use-cases/list-task-types';

/**
 * GET /api/task-types.
 *
 * The response this returns is what makes the client type-agnostic: it renders forms from
 * these descriptors. Adding a task type changes the payload without changing this file,
 * this router, or anything the client does with it.
 */
export function createTaskTypesRouter(listTaskTypes: ListTaskTypesUseCase): Router {
  const router = Router();

  router.get('/task-types', (_req, res) => {
    res.status(200).json(listTaskTypes.execute());
  });

  return router;
}
