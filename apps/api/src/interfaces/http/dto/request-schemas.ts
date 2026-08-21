import { z, type ZodType } from 'zod';

import { zodIssuesToDetails } from '../../../domain/task-types/field-schema';
import { BadRequestError } from '../errors';

/**
 * The transport boundary. These schemas answer one question only: can this request be
 * turned into something a use case accepts? They do NOT answer whether the request is
 * *allowed* - that belongs to the workflow engine, and the difference is the difference
 * between 400 and 409/422.
 *
 * Concretely:
 *   `toStatus: "two"`  -> 400, it is not a number
 *   `toStatus: 2.5`    -> 409, it is a number but not a status (WF-3)
 *   `toStatus: 99`     -> 409, out of range for this type
 *   `data: "quotes"`   -> 400, it is not an object
 *   `data: {}`         -> 422, it is an object but not the one status 2 requires
 *
 * The type's own field rules are deliberately absent here: putting them at the boundary
 * would be a second source of truth and would need editing every time a task type is
 * added, which is the whole thing this architecture avoids.
 */

const uuid = z.string().uuid('must be a UUID');

/** `.strict()` throughout: an unrecognised key is a typo or a stale client, never noise. */
export const TaskIdParamsSchema = z.object({ id: uuid }).strict();

export const UserIdParamsSchema = z.object({ id: uuid }).strict();

export const CreateTaskBodySchema = z
  .object({
    type: z.string().trim().min(1, 'a task type is required'),
    assignedUserId: uuid,
    actorUserId: uuid,
  })
  .strict();

export const ChangeTaskStatusBodySchema = z
  .object({
    // Only "is it a number". Whether it is a legal status is the engine's call.
    toStatus: z.number({ invalid_type_error: 'toStatus must be a number' }),
    assignedUserId: uuid,
    actorUserId: uuid,
    // Opaque on purpose: the target status's schema is compiled from descriptors.
    data: z.record(z.unknown()).optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export const CloseTaskBodySchema = z
  .object({
    actorUserId: uuid,
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

/** ADR-012 - absent means every task; an unrecognised value is rejected, not ignored. */
export const UserTasksQuerySchema = z
  .object({ state: z.enum(['OPEN', 'CLOSED']).optional() })
  .strict();

export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;
export type ChangeTaskStatusBody = z.infer<typeof ChangeTaskStatusBodySchema>;
export type CloseTaskBody = z.infer<typeof CloseTaskBodySchema>;
export type UserTasksQuery = z.infer<typeof UserTasksQuerySchema>;

/**
 * Parses or throws `BadRequestError`. `where` prefixes the detail paths, so a client is
 * told `body.assignedUserId` rather than just `assignedUserId`.
 */
export function parseRequest<T>(schema: ZodType<T>, input: unknown, where: string): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new BadRequestError(
      `Invalid request ${where}`,
      zodIssuesToDetails(result.error, where),
    );
  }

  return result.data;
}
