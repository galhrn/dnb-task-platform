import type { TaskDto, TaskTypeDescriptor } from '@task-platform/contracts';
import type { JSX } from 'react';

import { TaskCard } from './TaskCard';

export interface TaskListProps {
  readonly tasks: readonly TaskDto[];
  readonly descriptors: readonly TaskTypeDescriptor[];
  readonly selectedId: string | null;
  readonly onSelect: (taskId: string) => void;
}

export function TaskList({
  tasks,
  descriptors,
  selectedId,
  onSelect,
}: TaskListProps): JSX.Element {
  if (tasks.length === 0) {
    return <p className="muted">No tasks assigned.</p>;
  }

  return (
    <div className="list">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          descriptor={descriptors.find((descriptor) => descriptor.type === task.type)}
          selected={task.id === selectedId}
          onSelect={() => onSelect(task.id)}
        />
      ))}
    </div>
  );
}
