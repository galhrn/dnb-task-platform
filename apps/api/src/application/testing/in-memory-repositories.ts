import type { TaskState } from '@task-platform/contracts';

import type { NewTaskSnapshot, TaskSnapshot } from '../../domain/task';
import { TaskNotFoundError, VersionConflictError } from '../../domain/workflow/errors';
import type { TransitionRecord } from '../../domain/workflow/workflow-engine';
import type {
  PersistedTask,
  PersistedTransition,
  TaskRepository,
  TaskWithHistory,
} from '../ports/task-repository';
import type { Repositories, UnitOfWork } from '../ports/unit-of-work';
import type { UserRecord, UserRepository } from '../ports/user-repository';

/**
 * In-memory doubles for the repository ports, so use-case tests run in milliseconds with
 * no container.
 *
 * These are FAKES, not mocks: they hold real state and enforce the same invariants the
 * TypeORM implementations do - the version guard, the append-only history, rollback on
 * failure. A lenient double is worse than no double, because a use case that mishandles
 * a concurrent write would pass against it and fail in production. The behaviour they
 * imitate is itself verified against Postgres in `task.repository.int.test.ts`.
 */

interface StoredTransition extends PersistedTransition {
  readonly taskId: string;
}

/** Deterministic ids and timestamps: a test that sorts by createdAt should not flake. */
const EPOCH = Date.UTC(2026, 0, 1);

export class InMemoryDatabase {
  tasks = new Map<string, PersistedTask>();
  transitions: StoredTransition[] = [];
  users = new Map<string, UserRecord>();

  private sequence = 0;

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  nextTimestamp(): Date {
    this.sequence += 1;
    return new Date(EPOCH + this.sequence * 1000);
  }

  withUsers(...users: readonly UserRecord[]): this {
    for (const user of users) {
      this.users.set(user.id, user);
    }

    return this;
  }

  snapshot(): Pick<InMemoryDatabase, 'tasks' | 'transitions' | 'users'> {
    return {
      tasks: new Map(this.tasks),
      transitions: [...this.transitions],
      users: new Map(this.users),
    };
  }

  restore(snapshot: Pick<InMemoryDatabase, 'tasks' | 'transitions' | 'users'>): void {
    this.tasks = new Map(snapshot.tasks);
    this.transitions = [...snapshot.transitions];
    this.users = new Map(snapshot.users);
  }

  transitionsFor(taskId: string): StoredTransition[] {
    return this.transitions.filter((transition) => transition.taskId === taskId);
  }
}

export function demoUser(id: string, name = `User ${id}`): UserRecord {
  return { id, name, email: `${id}@example.com`, createdAt: new Date(EPOCH) };
}

export class InMemoryTaskRepository implements TaskRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  create(task: NewTaskSnapshot, transition: TransitionRecord): Promise<PersistedTask> {
    const now = this.db.nextTimestamp();
    const persisted: PersistedTask = {
      ...task,
      id: this.db.nextId('task'),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.db.tasks.set(persisted.id, persisted);
    this.append(persisted.id, transition);

    return Promise.resolve(persisted);
  }

  findById(id: string): Promise<PersistedTask | null> {
    return Promise.resolve(this.db.tasks.get(id) ?? null);
  }

  findByIdWithHistory(id: string): Promise<TaskWithHistory | null> {
    const task = this.db.tasks.get(id);

    if (task === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve({ task, transitions: this.db.transitionsFor(id) });
  }

  findByAssignee(assignedUserId: string, state?: TaskState): Promise<PersistedTask[]> {
    const matches = [...this.db.tasks.values()]
      .filter((task) => task.assignedUserId === assignedUserId)
      .filter((task) => state === undefined || task.state === state)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return Promise.resolve(matches);
  }

  applyTransition(next: TaskSnapshot, transition: TransitionRecord): Promise<PersistedTask> {
    const current = this.db.tasks.get(next.id);

    // Exactly what `UPDATE ... WHERE id = ? AND version = ?` does when it matches nothing.
    if (current === undefined) {
      return Promise.reject(new TaskNotFoundError(next.id));
    }

    if (current.version !== next.version) {
      return Promise.reject(new VersionConflictError(next.version, current.version));
    }

    const saved: PersistedTask = {
      ...next,
      version: current.version + 1,
      createdAt: current.createdAt,
      updatedAt: this.db.nextTimestamp(),
    };

    this.db.tasks.set(saved.id, saved);
    this.append(saved.id, transition);

    return Promise.resolve(saved);
  }

  private append(taskId: string, transition: TransitionRecord): void {
    this.db.transitions.push({
      ...transition,
      taskId,
      id: this.db.nextId('transition'),
      createdAt: this.db.nextTimestamp(),
    });
  }
}

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  findById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.db.users.get(id) ?? null);
  }

  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.db.users.has(id));
  }

  list(): Promise<UserRecord[]> {
    const users = [...this.db.users.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    return Promise.resolve(users);
  }
}

/**
 * Real rollback semantics, cheaply: take a copy before the work and put it back if the
 * work throws. Without this a use-case test could not tell "committed" from "threw after
 * writing", which is precisely what a transaction boundary is for.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly db: InMemoryDatabase) {}

  async runInTransaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    const before = this.db.snapshot();

    try {
      return await work({
        tasks: new InMemoryTaskRepository(this.db),
        users: new InMemoryUserRepository(this.db),
      });
    } catch (error) {
      this.db.restore(before);
      throw error;
    }
  }
}
