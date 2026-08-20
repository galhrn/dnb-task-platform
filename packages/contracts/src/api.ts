/**
 * Request and response shapes for the HTTP API (project_context.md section 9).
 */

import type { TaskTypeDescriptor } from './task-types';

export type TaskState = 'OPEN' | 'CLOSED';

export type TransitionKind = 'CREATE' | 'FORWARD' | 'BACKWARD' | 'CLOSE';

export interface UserDto {
  id: string;
  name: string;
  email: string;
}

export interface TaskTransitionDto {
  id: string;
  /** null on the CREATE record. */
  fromStatus: number | null;
  /** null on the CLOSE record. */
  toStatus: number | null;
  kind: TransitionKind;
  payload: Record<string, unknown>;
  assignedUserId: string;
  createdAt: string;
}

export interface TaskDto {
  id: string;
  type: string;
  status: number;
  state: TaskState;
  assignedUserId: string;
  /** Read projection, keyed BY STATUS: { "2": { ... }, "3": { ... } } (ADR-007). */
  data: Record<string, Record<string, unknown>>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWithHistoryDto extends TaskDto {
  transitions: TaskTransitionDto[];
}

export interface CreateTaskRequest {
  type: string;
  assignedUserId: string;
}

/** Forward and backward both land here; direction is derived from `toStatus`. */
export interface ChangeTaskStatusRequest {
  toStatus: number;
  assignedUserId: string;
  data?: Record<string, unknown>;
  expectedVersion?: number;
}

/** No assignee: closing is a state change, not a status change (ADR-011). */
export interface CloseTaskRequest {
  expectedVersion?: number;
}

/** Optional `?state=` filter on GET /users/:id/tasks (ADR-012). */
export type TaskStateFilter = TaskState;

export type ListTaskTypesResponse = TaskTypeDescriptor[];

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
}
