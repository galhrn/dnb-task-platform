/**
 * Request and response shapes for the HTTP API (project_context.md section 9).
 */

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
  /** Who the task was handed to by this transition. */
  assignedUserId: string;
  /**
   * Who performed it. Self-asserted by the caller - there is no authentication in this
   * system (see Scope), so this is provenance, not an authenticated audit trail.
   */
  actorUserId: string;
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
  actorUserId: string;
}

/** Forward and backward both land here; direction is derived from `toStatus`. */
export interface ChangeTaskStatusRequest {
  toStatus: number;
  assignedUserId: string;
  actorUserId: string;
  data?: Record<string, unknown>;
  expectedVersion?: number;
}

/**
 * No assignee - closing is a state change, not a status change (ADR-011) - but it still
 * has an actor: somebody closed it.
 */
export interface CloseTaskRequest {
  actorUserId: string;
  expectedVersion?: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
}
