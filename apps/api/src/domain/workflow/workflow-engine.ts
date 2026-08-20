import type { TransitionKind } from '@task-platform/contracts';

import { statusSchemaOf, zodIssuesToDetails } from '../task-types/field-schema';
import {
  finalStatusOf,
  isValidStatus,
  type TaskTypeDefinition,
} from '../task-types/task-type-definition';
import {
  clearDataAfter,
  statusDataOf,
  withStatusData,
  type NewTaskSnapshot,
  type StatusData,
  type TaskSnapshot,
} from '../task';
import { InvalidTransitionError, TaskClosedError, ValidationFailedError } from './errors';

/**
 * The workflow engine. It enforces WF-1..WF-7 and it has never heard of "procurement":
 * everything type-specific arrives as a TaskTypeDefinition. Pure functions over plain
 * objects - no IO, no clock, no identity generation, nothing to mock.
 */

export const INITIAL_STATUS = 1;

/** One row of the append-only history (section 10). */
export interface TransitionRecord {
  /** null on the CREATE record. */
  readonly fromStatus: number | null;
  /** null on the CLOSE record. */
  readonly toStatus: number | null;
  readonly kind: TransitionKind;
  /** What the caller supplied for this move; backward moves and closes supply nothing. */
  readonly payload: StatusData;
  readonly assignedUserId: string;
}

export interface CreateTaskInput {
  readonly assignedUserId: string;
}

export interface ChangeStatusCommand {
  readonly toStatus: number;
  readonly assignedUserId: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface CreateTaskResult {
  readonly task: NewTaskSnapshot;
  readonly transition: TransitionRecord;
}

export interface TransitionResult {
  readonly task: TaskSnapshot;
  readonly transition: TransitionRecord;
}

/**
 * Guards a wiring mistake, not a user mistake: evaluating a task against another type's
 * definition can only happen if the caller looked the wrong thing up. Plain Error, so it
 * never becomes a 4xx.
 */
function assertDefinitionMatches(definition: TaskTypeDefinition, task: TaskSnapshot): void {
  if (definition.type !== task.type) {
    throw new Error(
      `Task "${task.id}" is of type "${task.type}" but was evaluated against "${definition.type}"`,
    );
  }
}

/** WF-1 / WF-7 - every status change names the user who takes the task next. */
function assertAssignee(assignedUserId: string): void {
  if (assignedUserId.trim().length === 0) {
    throw new ValidationFailedError('A status change must name the next assigned user', [
      { path: 'assignedUserId', message: 'An assigned user is required' },
    ]);
  }
}

/** WF-7 - the data required to ENTER the target status (ADR-005). */
function validateEntryData(
  definition: TaskTypeDefinition,
  task: TaskSnapshot,
  toStatus: number,
  input: Readonly<Record<string, unknown>>,
): StatusData {
  const parsed = statusSchemaOf(definition, toStatus).safeParse(input);

  if (!parsed.success) {
    throw new ValidationFailedError(
      `Status ${toStatus} of ${definition.type} was not entered with the data it requires`,
      zodIssuesToDetails(parsed.error, 'data'),
    );
  }

  // Section 8's escape hatch. The engine calls it blind; only the type knows what it checks.
  definition.onEnter?.({ task, toStatus, data: parsed.data });

  return parsed.data;
}

/**
 * Creates a task at status 1. WF-3a: nothing transitions into the creation status, so it
 * has no entry requirements and collects no data.
 */
export function createTask(
  definition: TaskTypeDefinition,
  input: CreateTaskInput,
): CreateTaskResult {
  assertAssignee(input.assignedUserId);

  return {
    task: {
      type: definition.type,
      status: INITIAL_STATUS,
      state: 'OPEN',
      assignedUserId: input.assignedUserId,
      data: {},
    },
    transition: {
      fromStatus: null,
      toStatus: INITIAL_STATUS,
      kind: 'CREATE',
      payload: {},
      assignedUserId: input.assignedUserId,
    },
  };
}

/** WF-4 - forward moves advance exactly one status. */
function moveForward(
  definition: TaskTypeDefinition,
  task: TaskSnapshot,
  command: ChangeStatusCommand,
): TransitionResult {
  if (command.toStatus !== task.status + 1) {
    throw new InvalidTransitionError(
      `Forward moves advance exactly one status: ${task.status} -> ${task.status + 1}, not ${command.toStatus}`,
    );
  }

  const payload = validateEntryData(definition, task, command.toStatus, command.data ?? {});

  return {
    task: {
      ...task,
      status: command.toStatus,
      assignedUserId: command.assignedUserId,
      data: withStatusData(task.data, command.toStatus, payload),
    },
    transition: {
      fromStatus: task.status,
      toStatus: command.toStatus,
      kind: 'FORWARD',
      payload,
      assignedUserId: command.assignedUserId,
    },
  };
}

/** WF-5 - backward moves may span any distance. WF-7b - and they clear what came after. */
function moveBackward(
  definition: TaskTypeDefinition,
  task: TaskSnapshot,
  command: ChangeStatusCommand,
): TransitionResult {
  // ADR-006: a backward move supplies nothing. What the target status requires was
  // collected on the way up and survives clear-forward untouched.
  if (command.data !== undefined && Object.keys(command.data).length > 0) {
    throw new ValidationFailedError('A backward move carries no data', [
      { path: 'data', message: 'Data is only supplied when moving forward' },
    ]);
  }

  const data = clearDataAfter(task.data, command.toStatus);

  // The target status is entered again, so its entry requirements are checked again -
  // against the retained payload. Status 1 declares none, so this is a no-op there.
  validateEntryData(definition, task, command.toStatus, statusDataOf(data, command.toStatus));

  return {
    task: {
      ...task,
      status: command.toStatus,
      assignedUserId: command.assignedUserId,
      data,
    },
    transition: {
      fromStatus: task.status,
      toStatus: command.toStatus,
      kind: 'BACKWARD',
      payload: {},
      assignedUserId: command.assignedUserId,
    },
  };
}

/**
 * The single entry point for both directions. Direction is DERIVED from the target
 * status - a caller never declares it, so a caller can never lie about it.
 */
export function changeTaskStatus(
  definition: TaskTypeDefinition,
  task: TaskSnapshot,
  command: ChangeStatusCommand,
): TransitionResult {
  assertDefinitionMatches(definition, task);

  // WF-2
  if (task.state === 'CLOSED') {
    throw new TaskClosedError(task.id);
  }

  assertAssignee(command.assignedUserId);

  // WF-3
  if (!isValidStatus(definition, command.toStatus)) {
    throw new InvalidTransitionError(
      `Status ${command.toStatus} is out of range for ${definition.type} (1..${finalStatusOf(definition)})`,
    );
  }

  // WF-4a - standing still is not a move.
  if (command.toStatus === task.status) {
    throw new InvalidTransitionError(`Task is already at status ${command.toStatus}`);
  }

  return command.toStatus > task.status
    ? moveForward(definition, task, command)
    : moveBackward(definition, task, command);
}

/** WF-6 - a task may only be closed at its final status. */
export function closeTask(definition: TaskTypeDefinition, task: TaskSnapshot): TransitionResult {
  assertDefinitionMatches(definition, task);

  // WF-2 / WF-6a - closing a closed task is an error, not idempotent success.
  if (task.state === 'CLOSED') {
    throw new TaskClosedError(task.id);
  }

  const finalStatus = finalStatusOf(definition);

  if (task.status !== finalStatus) {
    throw new InvalidTransitionError(
      `${definition.type} can only be closed at status ${finalStatus}, but the task is at ${task.status}`,
    );
  }

  // WF-6b / ADR-011 - closing hands the task to nobody. It stays where it is.
  return {
    task: { ...task, state: 'CLOSED' },
    transition: {
      fromStatus: task.status,
      toStatus: null,
      kind: 'CLOSE',
      payload: {},
      assignedUserId: task.assignedUserId,
    },
  };
}
