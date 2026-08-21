import type { TaskDto, TaskTypeDescriptor } from '@task-platform/contracts';
import type { JSX } from 'react';

export interface TaskCardProps {
  readonly task: TaskDto;
  readonly descriptor: TaskTypeDescriptor | undefined;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

/**
 * Every label here comes from the descriptor: the type's own name, the status's own name,
 * and how many statuses it has. Nothing is looked up in a table this component owns.
 */
export function TaskCard({ task, descriptor, selected, onSelect }: TaskCardProps): JSX.Element {
  const statusName = descriptor?.statuses[task.status - 1]?.name ?? `Status ${task.status}`;
  const finalStatus = descriptor?.statuses.length ?? task.status;

  return (
    <button type="button" className={selected ? 'card selected' : 'card'} onClick={onSelect}>
      <div className="card-head">
        <span className="type">{descriptor?.label ?? task.type}</span>
        <span className={task.state === 'OPEN' ? 'pill open' : 'pill closed'}>{task.state}</span>
      </div>
      <div className="card-body">
        <span className="status">
          {task.status}/{finalStatus} {statusName}
        </span>
      </div>
      <div className="card-foot muted">
        <code>{task.id.slice(0, 8)}</code> v{task.version}
      </div>
    </button>
  );
}
