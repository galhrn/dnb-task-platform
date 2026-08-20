import type { TaskRepository } from './task-repository';
import type { UserRepository } from './user-repository';

export interface Repositories {
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
}

/**
 * The transaction boundary, owned by the application layer (section 4).
 *
 * A use case says "all of this, or none of it" and stays ignorant of how that is
 * achieved; the infrastructure implementation hands it repositories bound to the
 * transactional entity manager. Read-only use cases skip it entirely.
 */
export interface UnitOfWork {
  runInTransaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
