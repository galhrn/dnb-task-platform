import type { ApiErrorDetail, ErrorCode } from '@task-platform/contracts';

/**
 * Every expected failure in the system is one of these. Each carries the `code`
 * that a single HTTP middleware maps to a status - no layer above the domain ever
 * decides what an error "means", and no route builds an error body by hand.
 */
export abstract class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly ApiErrorDetail[];

  protected constructor(code: ErrorCode, message: string, details: readonly ApiErrorDetail[] = []) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class TaskNotFoundError extends DomainError {
  constructor(taskId: string) {
    super('NOT_FOUND', `Task "${taskId}" does not exist`);
  }
}

export class UserNotFoundError extends DomainError {
  constructor(userId: string) {
    super('NOT_FOUND', `User "${userId}" does not exist`);
  }
}

export class TaskTypeNotFoundError extends DomainError {
  constructor(type: string) {
    super('NOT_FOUND', `Unknown task type "${type}"`);
  }
}

/** WF-3/4/5/6 - the move is understood but not permitted from where the task stands. */
export class InvalidTransitionError extends DomainError {
  constructor(message: string) {
    super('INVALID_TRANSITION', message);
  }
}

/** WF-2 - closed tasks are immutable. */
export class TaskClosedError extends DomainError {
  constructor(taskId: string) {
    super('TASK_CLOSED', `Task "${taskId}" is closed and can no longer be modified`);
  }
}

/** WF-7 - the move is permitted but the data required to enter the status is missing or wrong. */
export class ValidationFailedError extends DomainError {
  constructor(message: string, details: readonly ApiErrorDetail[] = []) {
    super('VALIDATION_FAILED', message, details);
  }
}

/** ADR-010 - somebody else moved the task while this request was in flight. */
export class VersionConflictError extends DomainError {
  constructor(expected: number, actual: number) {
    super(
      'VERSION_CONFLICT',
      `Task was modified concurrently: expected version ${expected}, found ${actual}`,
    );
  }
}
