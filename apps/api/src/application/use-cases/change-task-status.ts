import { TaskNotFoundError, UserNotFoundError } from '../../domain/workflow/errors';
import { changeTaskStatus } from '../../domain/workflow/workflow-engine';
import type { TaskTypeRegistry } from '../../domain/task-types/registry';
import type { PersistedTask } from '../ports/task-repository';
import type { UnitOfWork } from '../ports/unit-of-work';
import { assertExpectedVersion } from './expected-version';

export interface ChangeTaskStatusInput {
  readonly taskId: string;
  readonly toStatus: number;
  readonly assignedUserId: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly expectedVersion?: number;
}

/**
 * POST /tasks/:id/transitions - forward and backward alike. This use case decides
 * nothing about the workflow; it reads, hands the snapshot to the engine, and writes
 * whatever comes back.
 *
 * The whole thing runs in one transaction, and the read happens INSIDE it, so the version
 * the engine worked from is the version the write guards against (ADR-015).
 */
export class ChangeTaskStatusUseCase {
  constructor(
    private readonly registry: TaskTypeRegistry,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: ChangeTaskStatusInput): Promise<PersistedTask> {
    return this.unitOfWork.runInTransaction(async ({ tasks, users }) => {
      const task = await tasks.findById(input.taskId);

      if (task === null) {
        throw new TaskNotFoundError(input.taskId);
      }

      assertExpectedVersion(task, input.expectedVersion);

      const definition = this.registry.get(task.type);

      // The engine runs before the assignee is looked up. It is pure and free, so an
      // illegal move is rejected without a second query - and "you cannot skip a status"
      // is a more useful answer than "that user does not exist" when both are true.
      const { task: next, transition } = changeTaskStatus(definition, task, {
        toStatus: input.toStatus,
        assignedUserId: input.assignedUserId,
        ...(input.data === undefined ? {} : { data: input.data }),
      });

      if (!(await users.exists(input.assignedUserId))) {
        throw new UserNotFoundError(input.assignedUserId);
      }

      return tasks.applyTransition(next, transition);
    });
  }
}
