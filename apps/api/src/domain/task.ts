import type { TaskState } from '@task-platform/contracts';

export type { TaskState };

/** The payload collected when a task enters one status. */
export type StatusData = Readonly<Record<string, unknown>>;

/**
 * The read projection, keyed BY STATUS as a string: { "2": { ... }, "3": { ... } }.
 *
 * Keying by status rather than by field is what keeps the engine type-agnostic:
 * clear-forward (WF-7b) becomes a key filter instead of per-type field knowledge.
 */
export type TaskData = Readonly<Record<string, StatusData>>;

/**
 * A task as the domain sees it: a plain object. No ORM entity, no class, no
 * behaviour. Every engine function takes one of these and returns a new one.
 */
export interface TaskSnapshot {
  readonly id: string;
  readonly type: string;
  readonly status: number;
  readonly state: TaskState;
  readonly assignedUserId: string;
  readonly data: TaskData;
  readonly version: number;
}

/** A task the engine has produced but persistence has not yet given an identity to. */
export type NewTaskSnapshot = Omit<TaskSnapshot, 'id' | 'version'>;

export function isClosed(task: TaskSnapshot): boolean {
  return task.state === 'CLOSED';
}

export function statusDataOf(data: TaskData, status: number): StatusData {
  return data[String(status)] ?? {};
}

export function withStatusData(data: TaskData, status: number, payload: StatusData): TaskData {
  return { ...data, [String(status)]: payload };
}

/**
 * WF-7b - moving back to `status` drops everything collected for later statuses.
 * Keys that are not numeric cannot belong to a status and are dropped with them.
 */
export function clearDataAfter(data: TaskData, status: number): TaskData {
  const kept: Record<string, StatusData> = {};

  for (const [key, payload] of Object.entries(data)) {
    if (Number(key) <= status) {
      kept[key] = payload;
    }
  }

  return kept;
}
