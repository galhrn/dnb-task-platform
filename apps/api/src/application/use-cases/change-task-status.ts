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
  /** Who is making the move, as opposed to who receives the task. */
  readonly actorUserId: string;
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

  /**
   * @param input the task, the target status, who takes it, who is moving it, and any
   *   entry data. `expectedVersion` is the caller's stale-page check (ADR-015)
   * @returns the task as persisted after the move
   * @throws {TaskNotFoundError} if the task does not exist (404)
   * @throws {VersionConflictError} if `expectedVersion` is stale, or if the row moved
   *   between this request reading it and writing it back (409)
   * @throws {TaskClosedError} {InvalidTransitionError} {ValidationFailedError} whatever
   *   the workflow engine decides about the move itself (409 / 409 / 422)
   * @throws {UserNotFoundError} if the assignee or the actor does not exist (404)
   */
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
        actorUserId: input.actorUserId,
        ...(input.data === undefined ? {} : { data: input.data }),
      });

      for (const userId of new Set([input.assignedUserId, input.actorUserId])) {
        if (!(await users.exists(userId))) {
          throw new UserNotFoundError(userId);
        }
      }

      return tasks.applyTransition(next, transition);
    });
  }
}
