import type { TaskWithHistoryDto, TaskTypeDescriptor, UserDto } from '@task-platform/contracts';
import { type JSX, useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import { useChangeStatus, useCloseTask } from '../hooks/use-task-mutations';
import { DynamicFieldForm, initialValues, toPayload, type FieldValues } from './DynamicFieldForm';
import { ErrorBanner } from './ErrorBanner';

export interface StatusControlsProps {
  readonly task: TaskWithHistoryDto;
  readonly descriptor: TaskTypeDescriptor;
  readonly users: readonly UserDto[];
  /** Recorded as the actor on whatever this component does. */
  readonly currentUserId: string;
}

/**
 * Everything this component offers is DERIVED from the descriptor:
 *
 *   next status      = current + 1, if there is one   (WF-4)
 *   its form         = that status's own field list   (ADR-005)
 *   reverse targets  = every status below the current (WF-5)
 *   close permitted  = current === statuses.length    (WF-6)
 *
 * There is no table of what each type allows, because the ladder's length is the only
 * thing that differs between types. A two-status Marketing task will render one advance
 * button and a close button without this file being touched.
 *
 * The rules are still enforced server-side - hiding a button is a convenience, never the
 * enforcement. Reversing past a status the server would refuse is impossible here, but if
 * it were attempted the 409 would still come back and be shown.
 */
export function StatusControls({
  task,
  descriptor,
  users,
  currentUserId,
}: StatusControlsProps): JSX.Element {
  const finalStatus = descriptor.statuses.length;
  const nextStatus = task.status + 1;
  const nextFields = descriptor.statuses[nextStatus - 1]?.fields ?? [];

  const canAdvance = task.state === 'OPEN' && task.status < finalStatus;
  const canReverse = task.state === 'OPEN' && task.status > 1;
  const canClose = task.state === 'OPEN' && task.status === finalStatus;

  const changeStatus = useChangeStatus(task.id);
  const closeTask = useCloseTask(task.id);

  const [values, setValues] = useState<FieldValues>(() => initialValues(nextFields));
  const [assignee, setAssignee] = useState<string>(task.assignedUserId);
  const [reverseTo, setReverseTo] = useState<number>(1);

  // The task moved, so the form belongs to a different status now. Rebuilding from the
  // descriptor is what keeps this correct for a type this component has never seen.
  useEffect(() => {
    setValues(initialValues(nextFields));
    setAssignee(task.assignedUserId);
    setReverseTo(Math.max(1, task.status - 1));
    changeStatus.reset();
    closeTask.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the task's position
  }, [task.id, task.status, task.state, task.version]);

  const pending = changeStatus.isPending || closeTask.isPending;
  const failure = changeStatus.error ?? closeTask.error;
  const fieldError =
    failure instanceof ApiError ? (name: string) => failure.fieldError(name) : undefined;

  if (task.state === 'CLOSED') {
    return <p className="muted">This task is closed. Closed tasks are immutable (WF-2).</p>;
  }

  return (
    <div className="controls">
      <ErrorBanner error={failure} />

      <label className="field">
        <span className="field-label">Hand over to</span>
        <select value={assignee} disabled={pending} onChange={(e) => setAssignee(e.target.value)}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>

      {canAdvance && (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            changeStatus.mutate({
              toStatus: nextStatus,
              assignedUserId: assignee,
              actorUserId: currentUserId,
              data: toPayload(nextFields, values),
              expectedVersion: task.version,
            });
          }}
        >
          <h4>
            Advance to {nextStatus}. {descriptor.statuses[nextStatus - 1]?.name}
          </h4>

          <DynamicFieldForm
            fields={nextFields}
            values={values}
            onChange={setValues}
            errorFor={fieldError}
            disabled={pending}
          />

          <button type="submit" disabled={pending}>
            {pending ? 'Working…' : 'Advance'}
          </button>
        </form>
      )}

      {canReverse && (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            // No data: a backward move carries none, and what the target needs was already
            // collected on the way up (ADR-006).
            changeStatus.mutate({
              toStatus: reverseTo,
              assignedUserId: assignee,
              actorUserId: currentUserId,
              expectedVersion: task.version,
            });
          }}
        >
          <h4>Send back</h4>
          <label className="field">
            <span className="field-label">To status</span>
            <select
              value={reverseTo}
              disabled={pending}
              onChange={(event) => setReverseTo(Number(event.target.value))}
            >
              {descriptor.statuses.slice(0, task.status - 1).map((status, index) => (
                <option key={status.value} value={index + 1}>
                  {index + 1}. {status.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">Data collected after this status will be cleared (WF-7b).</p>

          <button type="submit" disabled={pending}>
            Send back
          </button>
        </form>
      )}

      {canClose && (
        <div className="panel">
          <h4>Close</h4>
          <p className="muted">
            Permitted only at the final status. The task stays with its current holder
            (ADR-011).
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              closeTask.mutate({ actorUserId: currentUserId, expectedVersion: task.version })
            }
          >
            Close task
          </button>
        </div>
      )}
    </div>
  );
}
