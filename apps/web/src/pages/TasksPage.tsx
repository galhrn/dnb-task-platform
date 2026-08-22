import { type JSX, useState } from 'react';

import { CreateTaskForm } from '../components/CreateTaskForm';
import { ErrorBanner } from '../components/ErrorBanner';
import { TaskDetails } from '../components/TaskDetails';
import { TaskList } from '../components/TaskList';
import { useTaskTypes, useUserTasks, useUsers } from '../hooks/queries';

/**
 * There is no authentication (section 2), so the app acts as a seeded user. The id below
 * is Ada from `npm run seed`; the picker in the header switches who you are, which is the
 * only way to watch a task change hands after a status change.
 *
 * This is also what the API records as the ACTOR on every transition. Without a login it
 * is self-asserted rather than authenticated - provenance, not proof.
 *
 * To change the default, edit this constant - it is the one hard-coded id in the client.
 */
const DEFAULT_USER_ID = '11111111-1111-4111-8111-111111111111';

const STATE_FILTERS = ['ALL', 'OPEN', 'CLOSED'] as const;

type StateFilter = (typeof STATE_FILTERS)[number];

/** A <select> hands back a plain string; this narrows it without asserting. */
function isStateFilter(value: string): value is StateFilter {
  return STATE_FILTERS.some((candidate) => candidate === value);
}

export function TasksPage(): JSX.Element {
  const [actingAs, setActingAs] = useState<string>(DEFAULT_USER_ID);
  const [filter, setFilter] = useState<StateFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const taskTypes = useTaskTypes();
  const users = useUsers();
  const tasks = useUserTasks(actingAs, filter === 'ALL' ? undefined : filter);

  if (taskTypes.isPending || users.isPending) {
    return <main className="loading">Loading…</main>;
  }

  if (taskTypes.error !== null || users.error !== null) {
    return (
      <main>
        <ErrorBanner error={taskTypes.error ?? users.error} />
        <p className="muted">Is the API running? `npm run dev` starts both.</p>
      </main>
    );
  }

  return (
    <main>
      <header className="app-head">
        <h1>Task Platform</h1>

        <div className="who">
          <label className="field inline">
            <span className="field-label">Current user</span>
            <select
              value={actingAs}
              onChange={(event) => {
                setActingAs(event.target.value);
                setSelectedId(null);
              }}
            >
              {users.data.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>

          {/* ADR-012: everything by default, narrowed on request. */}
          <label className="field inline">
            <span className="field-label">Showing</span>
            <select
              value={filter}
              onChange={(event) => {
                if (isStateFilter(event.target.value)) {
                  setFilter(event.target.value);
                }
              }}
            >
              <option value="ALL">All</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
        </div>
      </header>

      <div className="columns">
        <aside>
          <CreateTaskForm
            descriptors={taskTypes.data}
            users={users.data}
            currentUserId={actingAs}
            onCreated={setSelectedId}
          />

          <h3>Assigned tasks</h3>
          {tasks.isPending ? (
            <p className="muted">Loading…</p>
          ) : tasks.error !== null ? (
            <ErrorBanner error={tasks.error} />
          ) : (
            <TaskList
              tasks={tasks.data}
              descriptors={taskTypes.data}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </aside>

        <section>
          {selectedId === null ? (
            <p className="muted">Select a task to manage its lifecycle.</p>
          ) : (
            <TaskDetails
              taskId={selectedId}
              descriptors={taskTypes.data}
              users={users.data}
              currentUserId={actingAs}
            />
          )}
        </section>
      </div>
    </main>
  );
}
