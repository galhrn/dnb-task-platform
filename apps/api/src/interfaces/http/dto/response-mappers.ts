import type {
  TaskDto,
  TaskTransitionDto,
  TaskWithHistoryDto,
  UserDto,
} from '@task-platform/contracts';

import type {
  PersistedTask,
  PersistedTransition,
  TaskWithHistory,
} from '../../../application/ports/task-repository';
import type { UserRecord } from '../../../application/ports/user-repository';

/**
 * Application results -> the wire.
 *
 * The only real work here is turning Date into an ISO string: JSON has no date type, and
 * letting `JSON.stringify` do it implicitly would leave the contract depending on a
 * default rather than on a decision.
 */

export function toTaskDto(task: PersistedTask): TaskDto {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    state: task.state,
    assignedUserId: task.assignedUserId,
    data: task.data as Record<string, Record<string, unknown>>,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toTransitionDto(transition: PersistedTransition): TaskTransitionDto {
  return {
    id: transition.id,
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    kind: transition.kind,
    payload: transition.payload as Record<string, unknown>,
    assignedUserId: transition.assignedUserId,
    createdAt: transition.createdAt.toISOString(),
  };
}

export function toTaskWithHistoryDto(found: TaskWithHistory): TaskWithHistoryDto {
  return {
    ...toTaskDto(found.task),
    transitions: found.transitions.map(toTransitionDto),
  };
}

export function toUserDto(user: UserRecord): UserDto {
  return { id: user.id, name: user.name, email: user.email };
}
