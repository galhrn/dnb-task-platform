import type { FieldDescriptor } from '@task-platform/contracts';

import type { StatusData, TaskSnapshot } from '../task';

/** One rung of a task type's ladder. */
export interface StatusDefinition {
  readonly name: string;
  /** Data required to ENTER this status (ADR-005). Status 1 must declare none (WF-3a). */
  readonly fields: readonly FieldDescriptor[];
}

export interface OnEnterContext {
  /** The snapshot as it stood BEFORE the move. */
  readonly task: TaskSnapshot;
  readonly toStatus: number;
  /** Already parsed against the status schema. */
  readonly data: StatusData;
}

/**
 * The escape hatch (section 8) for rules a descriptor cannot express - "quote B must
 * be lower than quote A", say. Throws a ValidationFailedError to reject. Opt-in
 * composition, not inheritance: the engine calls it if it exists and knows nothing
 * about what it does.
 */
export type OnEnterHook = (context: OnEnterContext) => void;

/**
 * The entire contract a task type implements. Two required things: an ordered list of
 * statuses, and the data required to enter each one. Everything else the workflow
 * needs - the final status, the legal range, whether a move is forward or backward -
 * is derived from that list.
 */
export interface TaskTypeDefinition {
  /** Registry key, e.g. 'PROCUREMENT'. */
  readonly type: string;
  readonly label: string;
  /** Ordered; index i holds status i + 1. Never empty. */
  readonly statuses: readonly StatusDefinition[];
  readonly onEnter?: OnEnterHook;
}

/** WF-6 - derived from the list, never hard-coded. */
export function finalStatusOf(definition: TaskTypeDefinition): number {
  return definition.statuses.length;
}

export function statusDefinitionOf(
  definition: TaskTypeDefinition,
  status: number,
): StatusDefinition | undefined {
  return definition.statuses[status - 1];
}

/** WF-3 - statuses are ascending integers starting at 1. */
export function isValidStatus(definition: TaskTypeDefinition, status: number): boolean {
  return Number.isInteger(status) && status >= 1 && status <= finalStatusOf(definition);
}
