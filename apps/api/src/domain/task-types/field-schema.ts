import type {
  ApiErrorDetail,
  BooleanFieldDescriptor,
  DateFieldDescriptor,
  FieldDescriptor,
  FieldKind,
  NumberFieldDescriptor,
  StringArrayFieldDescriptor,
  StringFieldDescriptor,
} from '@task-platform/contracts';
import { z, type ZodError, type ZodTypeAny } from 'zod';

import { statusDefinitionOf, type TaskTypeDefinition } from './task-type-definition';

/**
 * Descriptors are the single source of truth (ADR-009): this compiler turns them into
 * the Zod schema used for validation, while the very same descriptors are served to the
 * client as form metadata. One declaration, so the two can never drift apart.
 */

type FieldSchemaBuilder<K extends FieldKind> = (
  field: Extract<FieldDescriptor, { kind: K }>,
) => ZodTypeAny;

/**
 * The descriptor vocabulary, one entry per primitive kind (ADR-014).
 *
 * A lookup table rather than a strategy interface with registration and injection: this
 * is a CLOSED set that changes about once a project, not the open axis the architecture
 * is built around - that axis is task types, and it is served by the registry next door.
 * The mapped type keeps what a `switch` gave us: adding a `FieldKind` without an entry
 * here is a compile error, not a runtime surprise. See README, "Design decisions".
 */
const FIELD_SCHEMA_BUILDERS: { [K in FieldKind]: FieldSchemaBuilder<K> } = {
  string: (field: StringFieldDescriptor): ZodTypeAny => {
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
      schema = schema.max(
        field.maxLength,
        `${field.label} must be at most ${field.maxLength} characters`,
      );
    }

    return schema;
  },

  number: (field: NumberFieldDescriptor): ZodTypeAny => {
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
  },

  boolean: (field: BooleanFieldDescriptor): ZodTypeAny =>
    // No coercion: the string "false" is not a boolean, and quietly reading it as one
    // is how a checkbox ends up permanently ticked.
    z.boolean({ invalid_type_error: `${field.label} must be true or false` }),

  date: (field: DateFieldDescriptor): ZodTypeAny => {
    const base = z
      .string({ invalid_type_error: `${field.label} must be a date` })
      .date(`${field.label} must be a calendar date in YYYY-MM-DD form`);

    const { min, max } = field;

    if (min === undefined && max === undefined) {
      return base;
    }

    // YYYY-MM-DD is fixed-width, so string comparison is date comparison.
    return base.superRefine((value, ctx) => {
      if (min !== undefined && value < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field.label} must be on or after ${min}`,
        });
      }

      if (max !== undefined && value > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field.label} must be on or before ${max}`,
        });
      }
    });
  },

  'string-array': (field: StringArrayFieldDescriptor): ZodTypeAny => {
    const itemMinLength = field.itemMinLength ?? 1;

    let schema = z.array(
      z
        .string({ invalid_type_error: `Every ${field.label} entry must be text` })
        .trim()
        .min(itemMinLength, `Every ${field.label} entry must not be empty`),
      { invalid_type_error: `${field.label} must be a list` },
    );

    if (field.minItems !== undefined) {
      schema = schema.min(
        field.minItems,
        `${field.label} must contain at least ${field.minItems} entries`,
      );
    }

    if (field.maxItems !== undefined) {
      schema = schema.max(
        field.maxItems,
        `${field.label} must contain at most ${field.maxItems} entries`,
      );
    }

    return schema;
  },
};

function buildBaseSchema(field: FieldDescriptor): ZodTypeAny {
  // TypeScript cannot correlate the key with the value type across a union lookup, so
  // this one widening lives here rather than in every builder. The mapped type above
  // still guarantees the table is total and that each builder sees its own descriptor.
  const builders = FIELD_SCHEMA_BUILDERS as Record<
    FieldKind,
    (field: FieldDescriptor) => ZodTypeAny
  >;

  return builders[field.kind](field);
}

function compileFieldSchema(field: FieldDescriptor): ZodTypeAny {
  const schema = buildBaseSchema(field);
  return field.required ? schema : schema.optional();
}

/**
 * Compiles a status's field descriptors into the schema that validates entry to it.
 *
 * `.strict()` on purpose: a key the type never declared is a typo or a stale client, and
 * silently storing it in the JSONB projection would be the quiet kind of bug.
 *
 * The return type is inferred deliberately - `StatusSchema` below is defined as
 * `ReturnType<typeof compileStatusSchema>`, so annotating it here would be circular.
 *
 * @param fields the target status's entry requirements; an empty list yields a schema
 *   that accepts `{}` and rejects everything else
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
