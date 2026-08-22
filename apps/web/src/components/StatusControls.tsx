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
 * thing that differs between types. A two-status task renders one forward action and a
 * close without this file being touched.
 *
 * The LAYOUT follows the decision a person is making rather than the three endpoints
 * behind it. One card: who takes it next, then the single action that moves the task on -
 * forwards mid-ladder, closing at the end - and below a divider, the way back. The
 * assignee sits inside the card because it is part of the same submission as whichever
 * button is pressed; detached, it reads as unrelated configuration.
 *
 * Hiding a button is a convenience, never the enforcement. The rules are enforced
 * server-side, and a refused move still returns its 409 and is shown.
 */
export function StatusControls({
  task,
  descriptor,
  users,
  currentUserId,
}: StatusControlsProps): JSX.Element {
  const finalStatus = descriptor.statuses.length;
  const nextStatus = task.status + 1;
  const nextStatusName = descriptor.statuses[nextStatus - 1]?.name;
  const nextFields = descriptor.statuses[nextStatus - 1]?.fields ?? [];

  const isOpen = task.state === 'OPEN';
  const canAdvance = isOpen && task.status < finalStatus;
  const canReverse = isOpen && task.status > 1;
  const canClose = isOpen && task.status === finalStatus;

  const changeStatus = useChangeStatus(task.id);
  const closeTask = useCloseTask(task.id);

  const [values, setValues] = useState<FieldValues>(() => initialValues(nextFields));
  const [assignee, setAssignee] = useState<string>(task.assignedUserId);
  const [reverseTo, setReverseTo] = useState<number>(1);

  // The task moved, so the form belongs to a different status now. Rebuilding from the
  // descriptor is what keeps this correct for a type this component has never seen.
  //
  // The dependency list is intentionally the task's identity and position rather than the
  // values this effect reads. `nextFields` is derived from the descriptor on every render,
  // so depending on it would re-run the effect each time and wipe what the user is typing;
  // the mutation objects are likewise new each render. Position is what makes the form
  // stale, so position is what this watches.
  useEffect(() => {
    setValues(initialValues(nextFields));
    setAssignee(task.assignedUserId);
    setReverseTo(Math.max(1, task.status - 1));
    changeStatus.reset();
    closeTask.reset();
  }, [task.id, task.status, task.state, task.version]);

  const pending = changeStatus.isPending || closeTask.isPending;
  const failure = changeStatus.error ?? closeTask.error;
  const fieldError =
    failure instanceof ApiError ? (name: string) => failure.fieldError(name) : undefined;

  // WF-2, in the interface's own words. The rule id belongs in this comment, not on screen.
  if (!isOpen) {
    return (
      <section className="workflow">
        <p className="muted">This task is closed. Closed tasks can no longer be changed.</p>
      </section>
    );
  }

  return (
    <section className="workflow">
      <h3>Update task</h3>

      <ErrorBanner error={failure} />

      {/* One assignee for both directions, stated once and above the actions it belongs to. */}
      <div className="workflow-assignee">
        <label className="field">
          <span className="field-label">Assign to</span>
          <select
            value={assignee}
            disabled={pending}
            onChange={(event) => setAssignee(event.target.value)}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>

        <p className="hint">
          {canAdvance
            ? 'This person becomes the assignee.'
            : 'Applies when you send the task back. Closing keeps the current assignee.'}
        </p>
      </div>

      {/* The primary slot: whatever moves this task on from where it stands. */}
      {canAdvance && (
        <form
          className="workflow-primary"
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
            Next step: {nextStatus}. {nextStatusName}
          </h4>

          <DynamicFieldForm
            fields={nextFields}
            values={values}
            onChange={setValues}
            errorFor={fieldError}
            disabled={pending}
          />

          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Working…' : 'Submit & Forward'}
          </button>
        </form>
      )}

      {canClose && (
        <div className="workflow-primary">
          <h4>Final step reached</h4>
          <p className="hint">
            Closing finishes the task. It stays with its current holder, and nothing about it
            can be changed afterwards.
          </p>

          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={() =>
              closeTask.mutate({ actorUserId: currentUserId, expectedVersion: task.version })
            }
          >
            {pending ? 'Working…' : 'Close task'}
          </button>
        </div>
      )}

      {canReverse && (
        <form
          className="workflow-secondary"
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
          <span className="workflow-or">Not ready to move on?</span>

          <div className="workflow-back">
            <label className="field inline">
              <span className="field-label">Back to</span>
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

            {/* Fixed label. A backward move may span any distance (WF-5); which step it
                lands on is shown by the select beside it, not repeated in the button. */}
            <button type="submit" className="secondary" disabled={pending}>
              Return to Previous
            </button>
          </div>

          {/* WF-7b, said plainly. */}
          <p className="hint">Anything collected after that step is cleared.</p>
        </form>
      )}
    </section>
  );
}
