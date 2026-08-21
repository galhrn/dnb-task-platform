import type { PersistedTask } from '../ports/task-repository';
import { VersionConflictError } from '../../domain/workflow/errors';

/**
 * The second half of ADR-015.
 *
 * The repository always guards the write with the version this request READ, which closes
 * the lost-update window. `expectedVersion` is a different question: the caller is saying
 * "I was looking at version N when I decided this", and if the task has moved since then
 * the decision was made against a stale page - even though nothing is racing right now.
 */
export function assertExpectedVersion(task: PersistedTask, expectedVersion?: number): void {
  if (expectedVersion !== undefined && expectedVersion !== task.version) {
    throw new VersionConflictError(expectedVersion, task.version);
  }
}
