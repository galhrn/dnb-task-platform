import type { TaskState } from '@task-platform/contracts';

import type { NewTaskSnapshot, TaskSnapshot } from '../../domain/task';
import type { TransitionRecord } from '../../domain/workflow/workflow-engine';

/**
 * Repository PORTS. Declared here, in the application layer, and implemented in
 * infrastructure - so a use case depends on this file and never on TypeORM.
 */

/** A task as it comes back from storage: the domain snapshot plus its timestamps. */
export interface PersistedTask extends TaskSnapshot {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersistedTransition extends TransitionRecord {
  readonly id: string;
  readonly createdAt: Date;
}

export interface TaskWithHistory {
  readonly task: PersistedTask;
  readonly transitions: readonly PersistedTransition[];
}

export interface TaskRepository {
  /** Inserts the task and its CREATE history row. Atomic only inside a UnitOfWork. */
  create(task: NewTaskSnapshot, transition: TransitionRecord): Promise<PersistedTask>;

  findById(id: string): Promise<PersistedTask | null>;

  findByIdWithHistory(id: string): Promise<TaskWithHistory | null>;

  /** ADR-012 - every task by default; `state` narrows it. */
  findByAssignee(assignedUserId: string, state?: TaskState): Promise<PersistedTask[]>;

  /**
   * Writes the engine's next state and appends the history row, guarding the update with
   * the version the caller read (ADR-010, ADR-015).
   *
   * @throws VersionConflictError when the row moved underneath the caller
   * @throws TaskNotFoundError when the row is gone
   */
  applyTransition(next: TaskSnapshot, transition: TransitionRecord): Promise<PersistedTask>;
}
