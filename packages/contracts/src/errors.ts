/**
 * The error vocabulary. Domain errors carry a code; a single HTTP middleware
 * maps code -> status. Routes never build an error body by hand.
 */

/** Exported as a value, not only a type, so a consumer can enumerate the codes. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'INVALID_TRANSITION',
  'TASK_CLOSED',
  'VERSION_CONFLICT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** One field-level failure. `path` is the dotted location inside the request body. */
export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** The single response envelope for every non-2xx response. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: readonly ApiErrorDetail[];
  };
}
