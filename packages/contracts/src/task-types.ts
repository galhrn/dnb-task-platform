/**
 * Task-type metadata, as returned by GET /task-types.
 *
 * Field descriptors are the single source of truth (ADR-009): the server compiles
 * them into Zod schemas for validation, and the client renders forms from the very
 * same objects.
 *
 * The vocabulary is a CLOSED set of primitives (ADR-014) - anything richer belongs in
 * a task type's optional `onEnter` hook, not in the descriptor language. A `date` is a
 * calendar date, YYYY-MM-DD, deliberately without a time or a zone: it survives JSON
 * and JSONB unchanged and maps straight onto <input type="date">.
 */

export type FieldKind = 'string' | 'number' | 'boolean' | 'date' | 'string-array';

interface FieldDescriptorBase {
  /** Key inside the status payload, e.g. "receipt". camelCase (section 15). */
  name: string;
  /** Human label for the client form. */
  label: string;
  required: boolean;
}

export interface StringFieldDescriptor extends FieldDescriptorBase {
  kind: 'string';
  minLength?: number;
  maxLength?: number;
  /** Render hint only - a textarea rather than an input. Never affects validation. */
  multiline?: boolean;
}

export interface NumberFieldDescriptor extends FieldDescriptorBase {
  kind: 'number';
  min?: number;
  max?: number;
}

export interface BooleanFieldDescriptor extends FieldDescriptorBase {
  kind: 'boolean';
  // `required` means the key must be present. `false` is a value, not an absence.
}

export interface DateFieldDescriptor extends FieldDescriptorBase {
  kind: 'date';
  /** Inclusive bounds, in the same YYYY-MM-DD form as the value itself. */
  min?: string;
  max?: string;
}

export interface StringArrayFieldDescriptor extends FieldDescriptorBase {
  kind: 'string-array';
  minItems?: number;
  maxItems?: number;
  itemMinLength?: number;
}

export type FieldDescriptor =
  | StringFieldDescriptor
  | NumberFieldDescriptor
  | BooleanFieldDescriptor
  | DateFieldDescriptor
  | StringArrayFieldDescriptor;

export interface StatusDescriptor {
  /** Ascending integer starting at 1 (WF-3). */
  value: number;
  name: string;
  /** Data required to ENTER this status (ADR-005). Status 1 is always empty. */
  fields: FieldDescriptor[];
}

export interface TaskTypeDescriptor {
  /** Registry key, e.g. "PROCUREMENT". */
  type: string;
  label: string;
  /** Ordered. The final status is the last element - never a hard-coded bound. */
  statuses: StatusDescriptor[];
}
