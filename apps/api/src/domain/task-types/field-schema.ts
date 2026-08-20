import type { ApiErrorDetail, FieldDescriptor } from '@task-platform/contracts';
import { z, type ZodError, type ZodTypeAny } from 'zod';

import { statusDefinitionOf, type TaskTypeDefinition } from './task-type-definition';

/**
 * Descriptors are the single source of truth (ADR-009): this compiler turns them into
 * the Zod schema used for validation, while the very same descriptors are served to the
 * client as form metadata. One declaration, so the two can never drift apart.
 *
 * The switch below is on the descriptor VOCABULARY - string, number, string-array -
 * which is fixed and closed. It is not a switch on task type, and adding a task type
 * never adds a branch to it.
 */
function buildBaseSchema(field: FieldDescriptor): ZodTypeAny {
  switch (field.kind) {
    case 'string': {
      // A required string is non-empty by default: in this domain "a value is required"
      // and "an empty string will do" are never both true.
      const minLength = field.minLength ?? (field.required ? 1 : 0);

      let schema = z
        .string({ invalid_type_error: `${field.label} must be text` })
        .trim()
        .min(
          minLength,
          minLength === 1
            ? `${field.label} must not be empty`
            : `${field.label} must be at least ${minLength} characters`,
        );

      if (field.maxLength !== undefined) {
        schema = schema.max(field.maxLength, `${field.label} must be at most ${field.maxLength} characters`);
      }

      return schema;
    }

    case 'number': {
      let schema = z
        .number({ invalid_type_error: `${field.label} must be a number` })
        .finite(`${field.label} must be a finite number`);

      if (field.min !== undefined) {
        schema = schema.min(field.min, `${field.label} must be at least ${field.min}`);
      }

      if (field.max !== undefined) {
        schema = schema.max(field.max, `${field.label} must be at most ${field.max}`);
      }

      return schema;
    }

    case 'string-array': {
      const itemMinLength = field.itemMinLength ?? 1;

      let schema = z.array(
        z
          .string({ invalid_type_error: `Every ${field.label} entry must be text` })
          .trim()
          .min(itemMinLength, `Every ${field.label} entry must not be empty`),
        { invalid_type_error: `${field.label} must be a list` },
      );

      if (field.minItems !== undefined) {
        schema = schema.min(field.minItems, `${field.label} must contain at least ${field.minItems} entries`);
      }

      if (field.maxItems !== undefined) {
        schema = schema.max(field.maxItems, `${field.label} must contain at most ${field.maxItems} entries`);
      }

      return schema;
    }
  }
}

export function compileFieldSchema(field: FieldDescriptor): ZodTypeAny {
  const schema = buildBaseSchema(field);
  return field.required ? schema : schema.optional();
}

/**
 * `.strict()` on purpose: a key the type never declared is a typo or a stale client, and
 * silently storing it in the JSONB projection would be the quiet kind of bug.
 */
export function compileStatusSchema(fields: readonly FieldDescriptor[]) {
  const shape: Record<string, ZodTypeAny> = {};

  for (const field of fields) {
    shape[field.name] = compileFieldSchema(field);
  }

  return z.object(shape).strict();
}

export type StatusSchema = ReturnType<typeof compileStatusSchema>;

/**
 * Compiling is deterministic, so results are memoised per definition. The WeakMap keeps
 * a throwaway type registered inside a test from outliving it.
 */
const schemaCache = new WeakMap<TaskTypeDefinition, Map<number, StatusSchema>>();

export function statusSchemaOf(definition: TaskTypeDefinition, status: number): StatusSchema {
  let compiledStatuses = schemaCache.get(definition);

  if (compiledStatuses === undefined) {
    compiledStatuses = new Map<number, StatusSchema>();
    schemaCache.set(definition, compiledStatuses);
  }

  const cached = compiledStatuses.get(status);

  if (cached !== undefined) {
    return cached;
  }

  const compiled = compileStatusSchema(statusDefinitionOf(definition, status)?.fields ?? []);
  compiledStatuses.set(status, compiled);

  return compiled;
}

/** Zod issues -> the `details` array of the error envelope. */
export function zodIssuesToDetails(error: ZodError, prefix?: string): ApiErrorDetail[] {
  return error.issues.map((issue) => {
    const segments = [prefix, ...issue.path.map(String)].filter(
      (segment): segment is string => segment !== undefined && segment.length > 0,
    );

    return { path: segments.join('.'), message: issue.message };
  });
}
