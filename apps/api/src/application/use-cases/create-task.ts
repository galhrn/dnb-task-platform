import { UserNotFoundError } from '../../domain/workflow/errors';
import { createTask } from '../../domain/workflow/workflow-engine';
import type { TaskTypeRegistry } from '../../domain/task-types/registry';
import type { PersistedTask } from '../ports/task-repository';
import type { UnitOfWork } from '../ports/unit-of-work';

export interface CreateTaskInput {
  readonly type: string;
  readonly assignedUserId: string;
}

/**
 * POST /tasks.
 *
 * The registry lookup happens BEFORE the transaction: an unknown task type needs no
 * database to reject, and opening a transaction to find that out would be wasteful.
 */
export class CreateTaskUseCase {
  constructor(
    private readonly registry: TaskTypeRegistry,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CreateTaskInput): Promise<PersistedTask> {
    const definition = this.registry.get(input.type);

    return this.unitOfWork.runInTransaction(async ({ tasks, users }) => {
      // WF-1. The foreign key would catch this too, but as a 500 rather than a 404.
      if (!(await users.exists(input.assignedUserId))) {
        throw new UserNotFoundError(input.assignedUserId);
      }

      const { task, transition } = createTask(definition, {
        assignedUserId: input.assignedUserId,
      });

      // The task row and its CREATE history row commit together, or not at all.
      return tasks.create(task, transition);
    });
  }
}
