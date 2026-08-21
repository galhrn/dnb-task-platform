import { TaskNotFoundError } from '../../domain/workflow/errors';
import { closeTask } from '../../domain/workflow/workflow-engine';
import type { TaskTypeRegistry } from '../../domain/task-types/registry';
import type { PersistedTask } from '../ports/task-repository';
import type { UnitOfWork } from '../ports/unit-of-work';
import { assertExpectedVersion } from './expected-version';

export interface CloseTaskInput {
  readonly taskId: string;
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

  async execute(input: CloseTaskInput): Promise<PersistedTask> {
    return this.unitOfWork.runInTransaction(async ({ tasks }) => {
      const task = await tasks.findById(input.taskId);

      if (task === null) {
        throw new TaskNotFoundError(input.taskId);
      }

      assertExpectedVersion(task, input.expectedVersion);

      const { task: next, transition } = closeTask(this.registry.get(task.type), task);

      return tasks.applyTransition(next, transition);
    });
  }
}
