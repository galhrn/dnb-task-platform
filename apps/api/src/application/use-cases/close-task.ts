import { TaskNotFoundError, UserNotFoundError } from '../../domain/workflow/errors';
import { closeTask } from '../../domain/workflow/workflow-engine';
import type { TaskTypeRegistry } from '../../domain/task-types/registry';
import type { PersistedTask } from '../ports/task-repository';
import type { UnitOfWork } from '../ports/unit-of-work';
import { assertExpectedVersion } from './expected-version';

export interface CloseTaskInput {
  readonly taskId: string;
  /** Closing hands the task to nobody, but somebody still does the closing. */
  readonly actorUserId: string;
  readonly expectedVersion?: number;
}

/**
 * POST /tasks/:id/close.
 *
 * No assignee anywhere in this file: closing is a state change, not a status change, and
 * a terminal state has nobody to hand the task to (ADR-011, WF-6b). The task stays with
 * whoever held it.
 */
export class CloseTaskUseCase {
  constructor(
    private readonly registry: TaskTypeRegistry,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /**
   * @param input the task, who is closing it, and an optional `expectedVersion`
   * @returns the closed task, still held by the same user (ADR-011)
   * @throws {TaskNotFoundError} if the task does not exist (404)
   * @throws {VersionConflictError} if `expectedVersion` is stale or the row moved (409)
   * @throws {TaskClosedError} if it is already closed (409)
   * @throws {InvalidTransitionError} if it has not reached its final status (409)
   * @throws {UserNotFoundError} if the actor does not exist (404)
   */
  async execute(input: CloseTaskInput): Promise<PersistedTask> {
    return this.unitOfWork.runInTransaction(async ({ tasks, users }) => {
      const task = await tasks.findById(input.taskId);

      if (task === null) {
        throw new TaskNotFoundError(input.taskId);
      }

      assertExpectedVersion(task, input.expectedVersion);

      const { task: next, transition } = closeTask(
        this.registry.get(task.type),
        task,
        input.actorUserId,
      );

      if (!(await users.exists(input.actorUserId))) {
        throw new UserNotFoundError(input.actorUserId);
      }

      return tasks.applyTransition(next, transition);
    });
  }
}
