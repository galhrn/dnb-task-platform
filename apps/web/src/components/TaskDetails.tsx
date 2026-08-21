import type { TaskTypeDescriptor, UserDto } from '@task-platform/contracts';
import type { JSX } from 'react';

import { useTask } from '../hooks/queries';
import { ErrorBanner } from './ErrorBanner';
import { StatusControls } from './StatusControls';

export interface TaskDetailsProps {
  readonly taskId: string;
  readonly descriptors: readonly TaskTypeDescriptor[];
  readonly users: readonly UserDto[];
}

function userName(users: readonly UserDto[], id: string): string {
  return users.find((user) => user.id === id)?.name ?? id.slice(0, 8);
}

export function TaskDetails({ taskId, descriptors, users }: TaskDetailsProps): JSX.Element {
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
        {descriptor.statuses.map((status) => (
          <li
            key={status.value}
            className={
              status.value === task.status
                ? 'current'
                : status.value < task.status
                  ? 'done'
                  : 'ahead'
            }
          >
            <span className="rung">{status.value}</span>
            <span>{status.name}</span>
          </li>
        ))}
      </ol>

      <dl className="meta">
        <dt>Held by</dt>
        <dd>{userName(users, task.assignedUserId)}</dd>
        <dt>Version</dt>
        <dd>{task.version}</dd>
        <dt>Id</dt>
        <dd>
          <code>{task.id}</code>
        </dd>
      </dl>

      <StatusControls task={task} descriptor={descriptor} users={users} />

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
              <th>Handed to</th>
            </tr>
          </thead>
          <tbody>
            {task.transitions.map((transition) => (
              <tr key={transition.id}>
                <td>{new Date(transition.createdAt).toLocaleTimeString()}</td>
                <td>
                  {transition.fromStatus ?? '—'} → {transition.toStatus ?? '—'}
                </td>
                <td>
                  <code>{transition.kind}</code>
                </td>
                <td>{userName(users, transition.assignedUserId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
