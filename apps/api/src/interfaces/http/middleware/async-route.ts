import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch a rejected promise from a handler - it hangs the request
 * instead. Every async route goes through this, so a thrown DomainError reaches the error
 * middleware exactly like a synchronous one.
 *
 * (Express 5 forwards rejections natively; this wrapper is the one thing that would be
 * deleted on upgrade.)
 */
export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}
