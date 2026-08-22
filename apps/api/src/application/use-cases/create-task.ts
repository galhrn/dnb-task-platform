import { UserNotFoundError } from '../../domain/workflow/errors';
import { createTask } from '../../domain/workflow/workflow-engine';
import type { TaskTypeRegistry } from '../../domain/task-types/registry';
import type { PersistedTask } from '../ports/task-repository';
import type { UnitOfWork } from '../ports/unit-of-work';

export interface CreateTaskInput {
  readonly type: string;
  readonly assignedUserId: string;
  /** Who is creating it. Self-asserted; there is no authentication (section 2). */
  readonly actorUserId: string;
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

  /**
   * @param input the type to create, who it starts with, and who is creating it
   * @returns the persisted task at status 1, version 1
   * @throws {TaskTypeNotFoundError} if the type is not registered (404)
   * @throws {UserNotFoundError} if the assignee or the actor does not exist (404)
   */
  async execute(input: CreateTaskInput): Promise<PersistedTask> {
    const definition = this.registry.get(input.type);

    return this.unitOfWork.runInTransaction(async ({ tasks, users }) => {
      // WF-1. The foreign key would catch these too, but as a 500 rather than a 404.
      for (const userId of new Set([input.assignedUserId, input.actorUserId])) {
        if (!(await users.exists(userId))) {
          throw new UserNotFoundError(userId);
        }
      }

      const { task, transition } = createTask(definition, {
        assignedUserId: input.assignedUserId,
        actorUserId: input.actorUserId,
      });

      // The task row and its CREATE history row commit together, or not at all.
      return tasks.create(task, transition);
    });
  }
}
