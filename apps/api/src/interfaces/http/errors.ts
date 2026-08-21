import type { ApiErrorDetail } from '@task-platform/contracts';

import { DomainError } from '../../domain/workflow/errors';

/**
 * Boundary errors.
 *
 * A malformed request is not a domain concept - the domain never sees one, because the
 * request is rejected before a use case is called. They live here rather than in
 * `domain/workflow/errors.ts` for that reason, but they extend `DomainError` so that the
 * error middleware has exactly ONE shape to understand: something with an ErrorCode.
 */

/** The request could not be parsed into something a use case could accept. */
export class BadRequestError extends DomainError {
  constructor(message: string, details: readonly ApiErrorDetail[] = []) {
    super('BAD_REQUEST', message, details);
  }
}

/** No route matched. Reported through the same envelope as everything else. */
export class RouteNotFoundError extends DomainError {
  constructor(method: string, path: string) {
    super('NOT_FOUND', `Cannot ${method} ${path}`);
  }
}
