import type { TaskTypeDescriptor, UserDto } from '@task-platform/contracts';
import type { JSX } from 'react';

import { useTask } from '../hooks/queries';
import { ErrorBanner } from './ErrorBanner';
import { StatusControls } from './StatusControls';

export interface TaskDetailsProps {
  readonly taskId: string;
  readonly descriptors: readonly TaskTypeDescriptor[];
  readonly users: readonly UserDto[];
  readonly currentUserId: string;
}

function userName(users: readonly UserDto[], id: string): string {
  return users.find((user) => user.id === id)?.name ?? id.slice(0, 8);
}

/** Date and time, because history spanning a day is otherwise ambiguous. */
function formatMoment(iso: string): string {
  const at = new Date(iso);

  return `${at.toLocaleDateString()} ${at.toLocaleTimeString()}`;
}

export function TaskDetails({
  taskId,
  descriptors,
  users,
  currentUserId,
}: TaskDetailsProps): JSX.Element {
  const { data: task, isPending, error } = useTask(taskId);

  if (isPending) {
    return <p className="muted">Loading task…</p>;
  }

  if (error !== null) {
    return <ErrorBanner error={error} />;
  }

  const descriptor = descriptors.find((candidate) => candidate.type === task.type);

  if (descriptor === undefined) {
    return <ErrorBanner error={new Error(`The server did not describe type ${task.type}`)} />;
  }

  return (
    <section className="details">
      <header>
        <h2>{descriptor.label}</h2>
        <span className={task.state === 'OPEN' ? 'pill open' : 'pill closed'}>{task.state}</span>
      </header>

      {/* The ladder, drawn from the descriptor. A type with two statuses draws two. */}
      <ol className="ladder">
        {descriptor.statuses.map((status) => {
          const reached = status.value < task.status;
          const here = status.value === task.status;

          return (
            <li key={status.value} className={here ? 'current' : reached ? 'done' : 'ahead'}>
              {/* A step that is behind you does not need its number repeated - it needs to
                  say it is finished. Plain Unicode, no icon font. */}
              <span className="rung">{reached ? '✓' : status.value}</span>
              <span>{status.name}</span>
            </li>
          );
        })}
      </ol>

      <details className="meta-details">
        <summary>
          <span className="meta-label">Held by:</span>{' '}
          <span className="meta-holder">{userName(users, task.assignedUserId)}</span>
        </summary>

        <dl className="meta">
          <dt>Version</dt>
          <dd>{task.version}</dd>
          <dt>Id</dt>
          <dd>
            <code>{task.id}</code>
          </dd>
        </dl>
      </details>

      <StatusControls
        task={task}
        descriptor={descriptor}
        users={users}
        currentUserId={currentUserId}
      />

      <details className="collected">
        <summary>Collected data</summary>
        {/* Keyed by status, so it is rendered by status - the client never needs to know
            which fields a type declares in order to show what was gathered. */}
        {Object.keys(task.data).length === 0 ? (
          <p className="muted">Nothing collected yet.</p>
        ) : (
          Object.entries(task.data).map(([status, payload]) => (
            <div key={status}>
              <h4>
                {status}. {descriptor.statuses[Number(status) - 1]?.name ?? 'Unknown status'}
              </h4>
              <pre>{JSON.stringify(payload, null, 2)}</pre>
            </div>
          ))
        )}
      </details>

      <details className="history" open>
        <summary>History ({task.transitions.length})</summary>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Move</th>
              <th>Kind</th>
              <th>By</th>
              <th>Handed to</th>
            </tr>
          </thead>
          <tbody>
            {task.transitions.map((transition) => (
              <tr key={transition.id}>
                <td className="when">{formatMoment(transition.createdAt)}</td>
                <td className="move">
                  {transition.fromStatus ?? '—'} → {transition.toStatus ?? '—'}
                </td>
                <td>
                  <code>{transition.kind}</code>
                </td>
                {/* Who did it, as distinct from who received it. On a CLOSE the task
                    changes hands to nobody, so the actor is the only name there is. */}
                <td className="actor">{userName(users, transition.actorUserId)}</td>
                <td className={transition.kind === 'CLOSE' ? 'muted' : undefined}>
                  {transition.kind === 'CLOSE'
                    ? 'nobody — closed'
                    : userName(users, transition.assignedUserId)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
