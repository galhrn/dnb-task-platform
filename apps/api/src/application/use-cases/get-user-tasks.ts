import type { TaskState } from '@task-platform/contracts';

import { UserNotFoundError } from '../../domain/workflow/errors';
import type { PersistedTask, TaskRepository } from '../ports/task-repository';
import type { UserRepository } from '../ports/user-repository';

export interface GetUserTasksInput {
  readonly userId: string;
  /** ADR-012 - absent means everything, open and closed. */
  readonly state?: TaskState;
}

/**
 * GET /users/:id/tasks. A read, so no transaction: there is nothing to make atomic.
 *
 * The user is checked first so that an unknown id is a 404 rather than an empty list -
 * "this user has no tasks" and "there is no such user" are different answers.
 */
export class GetUserTasksUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(input: GetUserTasksInput): Promise<PersistedTask[]> {
    if (!(await this.users.exists(input.userId))) {
      throw new UserNotFoundError(input.userId);
    }

    return this.tasks.findByAssignee(input.userId, input.state);
  }
}
