import type { TaskTypeDescriptor, UserDto } from '@task-platform/contracts';
import { type JSX, useState } from 'react';

import { useCreateTask } from '../hooks/use-task-mutations';
import { ErrorBanner } from './ErrorBanner';

export interface CreateTaskFormProps {
  readonly descriptors: readonly TaskTypeDescriptor[];
  readonly users: readonly UserDto[];
  /** Who is using the app: the default assignee, and the actor recorded on CREATE. */
  readonly currentUserId: string;
  readonly onCreated: (taskId: string) => void;
}

/**
 * The type list is whatever the server described. There is no hard-coded set of options
 * here, so a newly registered task type appears in this dropdown after a refresh with no
 * change to this file.
 *
 * Creation collects no task data at all: status 1 is the creation status and nothing
 * transitions into it, so it has no entry requirements (WF-3a).
 */
export function CreateTaskForm({
  descriptors,
  users,
  currentUserId,
  onCreated,
}: CreateTaskFormProps): JSX.Element {
  const [type, setType] = useState<string>(descriptors[0]?.type ?? '');
  const [assignee, setAssignee] = useState<string>(currentUserId);
  const createTask = useCreateTask();

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        createTask.mutate(
          { type, assignedUserId: assignee, actorUserId: currentUserId },
          { onSuccess: (task) => onCreated(task.id) },
        );
      }}
    >
      <h3>New task</h3>
      <ErrorBanner error={createTask.error} />

      <label className="field">
        <span className="field-label">Type</span>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {descriptors.map((descriptor) => (
            <option key={descriptor.type} value={descriptor.type}>
              {descriptor.label} ({descriptor.statuses.length} statuses)
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Assign to</span>
        <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" disabled={createTask.isPending || type.length === 0}>
        {createTask.isPending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}
