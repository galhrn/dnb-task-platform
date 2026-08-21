import type { ApiErrorBody, ErrorCode } from '@task-platform/contracts';
import type { ErrorRequestHandler } from 'express';

import { DomainError } from '../../../domain/workflow/errors';
import { getRequestId } from './request-id';

/**
 * The ONE place an error becomes an HTTP status. Routes never build an error body, and
 * nothing below this file knows what a status code is.
 *
 * Typed as a total map over ErrorCode, so adding a code without deciding its status is a
 * compile error rather than an accidental 500.
 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  // Three different reasons, one status: the request is legal but conflicts with the
  // state the task is actually in. The `code` in the envelope is what tells them apart.
  INVALID_TRANSITION: 409,
  TASK_CLOSED: 409,
  VERSION_CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

/** body-parser's signal that the request body was not valid JSON. */
function isMalformedJson(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'type' in error &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  );
}

function envelope(code: ErrorCode, message: string, details: readonly unknown[]): ApiErrorBody {
  const body: ApiErrorBody = { error: { code, message } };

  if (details.length > 0) {
    body.error.details = details as ApiErrorBody['error']['details'];
  }

  return body;
}

export function errorHandler(): ErrorRequestHandler {
  return (error: unknown, _req, res, next): void => {
    // Streaming already started: there is no status left to set, so hand it to Express.
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof DomainError) {
      res.status(STATUS_BY_CODE[error.code]).json(envelope(error.code, error.message, error.details));
      return;
    }

    if (isMalformedJson(error)) {
      res.status(400).json(envelope('BAD_REQUEST', 'Request body is not valid JSON', []));
      return;
    }

    // Anything left is a bug. The client gets an id and nothing else - an internal message
    // leaked into a response is how stack traces end up in screenshots.
    const requestId = getRequestId(res);

    console.error(`[api] unhandled error (request ${requestId})`, error);

    res
      .status(500)
      .json(envelope('INTERNAL_ERROR', `Unexpected error. Request id: ${requestId}`, []));
  };
}
