/**
 * Task-type metadata, as returned by GET /task-types.
 *
 * Field descriptors are the single source of truth (ADR-009): the server compiles
 * them into Zod schemas for validation, and the client renders forms from the very
 * same objects. The vocabulary is deliberately small - anything richer than this
 * belongs in a type's optional `onEnter` hook, not in the descriptor language.
 */

export type FieldKind = 'string' | 'number' | 'string-array';

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

export interface StringArrayFieldDescriptor extends FieldDescriptorBase {
  kind: 'string-array';
  minItems?: number;
  maxItems?: number;
  itemMinLength?: number;
}

export type FieldDescriptor =
  | StringFieldDescriptor
  | NumberFieldDescriptor
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
