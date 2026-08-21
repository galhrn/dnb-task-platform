import type {
  ApiErrorBody,
  ApiErrorDetail,
  ChangeTaskStatusRequest,
  CloseTaskRequest,
  CreateTaskRequest,
  ErrorCode,
  TaskDto,
  TaskState,
  TaskTypeDescriptor,
  TaskWithHistoryDto,
  UserDto,
} from '@task-platform/contracts';

/**
 * The only file in the client that knows HTTP exists. Everything above it works with the
 * shared contract types, which are the same objects the server produces - so a change to
 * the API shape is a TypeScript error here rather than a runtime surprise in a component.
 */

/** A failure the API described in its own envelope, carrying the code the server chose. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: readonly ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * The message for one descriptor field, if the server rejected it.
   *
   * Detail paths arrive as `data.receipt` or `data.quotes.1`, so a field owns its own
   * path and everything beneath it. This is what lets a 422 land under the right input
   * without the client knowing which fields exist.
   */
  fieldError(name: string): string | undefined {
    const prefix = `data.${name}`;

    return this.details.find(
      (detail) => detail.path === prefix || detail.path.startsWith(`${prefix}.`),
    )?.message;
  }
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body === undefined ? {} : { 'Content-Type': 'application/json' },
  });

  if (response.ok) {
    return (await response.json()) as T;
  }

  // Every non-2xx the API produces uses one envelope; anything else is a proxy or a crash.
  let body: ApiErrorBody | undefined;

  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = undefined;
  }

  if (body?.error === undefined) {
    throw new ApiError(response.status, 'INTERNAL_ERROR', `Request failed (${response.status})`);
  }

  throw new ApiError(response.status, body.error.code, body.error.message, body.error.details ?? []);
}

export const api = {
  listTaskTypes: (): Promise<TaskTypeDescriptor[]> => send('/task-types'),

  listUsers: (): Promise<UserDto[]> => send('/users'),

  getUserTasks: (userId: string, state?: TaskState): Promise<TaskDto[]> =>
    send(`/users/${userId}/tasks${state === undefined ? '' : `?state=${state}`}`),

  getTask: (taskId: string): Promise<TaskWithHistoryDto> => send(`/tasks/${taskId}`),

  createTask: (body: CreateTaskRequest): Promise<TaskDto> =>
    send('/tasks', { method: 'POST', body: JSON.stringify(body) }),

  changeStatus: (taskId: string, body: ChangeTaskStatusRequest): Promise<TaskDto> =>
    send(`/tasks/${taskId}/transitions`, { method: 'POST', body: JSON.stringify(body) }),

  closeTask: (taskId: string, body: CloseTaskRequest): Promise<TaskDto> =>
    send(`/tasks/${taskId}/close`, { method: 'POST', body: JSON.stringify(body) }),
};
