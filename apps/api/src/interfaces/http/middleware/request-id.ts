import { randomUUID } from 'node:crypto';

import type { RequestHandler, Response } from 'express';

const REQUEST_ID = 'requestId';

/**
 * One id per request, echoed as `X-Request-Id` and quoted in any 500 (section 9). A user
 * reporting "it failed" can hand over the id, and it appears verbatim in the log line.
 */
export function requestId(): RequestHandler {
  return (_req, res, next): void => {
    const id = randomUUID();

    res.locals[REQUEST_ID] = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

/** `res.locals` is loosely typed by Express; the cast is contained to this one reader. */
export function getRequestId(res: Response): string {
  const value: unknown = res.locals[REQUEST_ID];

  return typeof value === 'string' ? value : 'unknown';
}
