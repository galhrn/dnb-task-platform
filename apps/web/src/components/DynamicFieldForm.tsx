import type { FieldDescriptor, FieldKind } from '@task-platform/contracts';
import type { JSX } from 'react';

/**
 * The client-side half of the extensibility claim.
 *
 * This renders whatever `GET /task-types` said a status requires. It has never heard of
 * procurement, development, quotes or receipts - it knows only the five primitive kinds,
 * which is the same closed vocabulary the server compiles its Zod schemas from (ADR-014).
 *
 * The renderer table mirrors `field-schema.ts` on the server deliberately: adding a field
 * KIND is one entry on each side; adding a task TYPE is nothing on either. The mapped type
 * makes a missing kind a compile error rather than a blank space in a form.
 */

export type FieldValues = Record<string, unknown>;

interface FieldProps<D extends FieldDescriptor> {
  readonly descriptor: D;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
}

type FieldRenderer<K extends FieldKind> = (
  props: FieldProps<Extract<FieldDescriptor, { kind: K }>>,
) => JSX.Element;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString) : [];
}

const RENDERERS: { [K in FieldKind]: FieldRenderer<K> } = {
  string: ({ descriptor, value, disabled, onChange }) =>
    descriptor.multiline === true ? (
      <textarea
        rows={4}
        value={asString(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    ) : (
      <input
        type="text"
        value={asString(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    ),

  number: ({ descriptor, value, disabled, onChange }) => (
    <input
      type="number"
      value={typeof value === 'number' ? String(value) : asString(value)}
      min={descriptor.min}
      max={descriptor.max}
      disabled={disabled}
      // Empty stays empty rather than becoming 0 - the server must be allowed to say
      // "required", and a silent 0 would rob it of the chance.
      onChange={(event) =>
        onChange(event.target.value === '' ? '' : Number(event.target.value))
      }
    />
  ),

  boolean: ({ value, disabled, onChange }) => (
    <input
      type="checkbox"
      checked={value === true}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),

  date: ({ descriptor, value, disabled, onChange }) => (
    <input
      type="date"
      value={asString(value)}
      min={descriptor.min}
      max={descriptor.max}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),

  'string-array': ({ descriptor, value, disabled, onChange }) => {
    const entries = asStringArray(value);
    const canAdd = descriptor.maxItems === undefined || entries.length < descriptor.maxItems;
    const canRemove = entries.length > (descriptor.minItems ?? 0);

    return (
      <div className="entries">
        {entries.map((entry, index) => (
          // eslint-disable-next-line react/no-array-index-key -- the index IS the identity
          <div className="entry" key={index}>
            <input
              type="text"
              value={entry}
              disabled={disabled}
              onChange={(event) =>
                onChange(entries.map((old, at) => (at === index ? event.target.value : old)))
              }
            />
            {canRemove && (
              <button
                type="button"
                className="ghost"
                disabled={disabled}
                onClick={() => onChange(entries.filter((_old, at) => at !== index))}
              >
                remove
              </button>
            )}
          </div>
        ))}
        {canAdd && (
          <button
            type="button"
            className="ghost"
            disabled={disabled}
            onClick={() => onChange([...entries, ''])}
          >
            add entry
          </button>
        )}
      </div>
    );
  },
};

function renderField(props: FieldProps<FieldDescriptor>): JSX.Element {
  // Same one widening as the server's compiler, for the same reason: TypeScript cannot
  // correlate a key with its value type across a union lookup.
  const renderers = RENDERERS as Record<FieldKind, FieldRenderer<FieldKind>>;

  return renderers[props.descriptor.kind](props);
}

/** The starting value for a field, derived from its descriptor alone. */
export function initialValues(fields: readonly FieldDescriptor[]): FieldValues {
  const values: FieldValues = {};

  for (const field of fields) {
    switch (field.kind) {
      case 'boolean':
        values[field.name] = false;
        break;
      case 'string-array':
        values[field.name] = Array.from({ length: field.minItems ?? 1 }, () => '');
        break;
      default:
        values[field.name] = '';
    }
  }

  return values;
}

/**
 * Values -> request payload. Empty optional fields are dropped so the server sees "absent"
 * rather than "empty"; empty REQUIRED fields are sent as they are, so the server rejects
 * them and says why. Guessing on the client's side would only hide the real rule.
 */
export function toPayload(
  fields: readonly FieldDescriptor[],
  values: FieldValues,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    const value = values[field.name];
    const isEmpty = value === '' || value === undefined;

    if (isEmpty && !field.required) {
      continue;
    }

    payload[field.name] = value;
  }

  return payload;
}

export interface DynamicFieldFormProps {
  readonly fields: readonly FieldDescriptor[];
  readonly values: FieldValues;
  readonly onChange: (values: FieldValues) => void;
  readonly errorFor?: (name: string) => string | undefined;
  readonly disabled?: boolean;
}

export function DynamicFieldForm({
  fields,
  values,
  onChange,
  errorFor,
  disabled = false,
}: DynamicFieldFormProps): JSX.Element | null {
  if (fields.length === 0) {
    return <p className="muted">This status needs no data.</p>;
  }

  return (
    <>
      {fields.map((field) => {
        const error = errorFor?.(field.name);

        return (
          <label className={error === undefined ? 'field' : 'field invalid'} key={field.name}>
            <span className="field-label">
              {field.label}
              {field.required && <span className="required"> *</span>}
            </span>

            {renderField({
              descriptor: field,
              value: values[field.name],
              error,
              disabled,
              onChange: (value) => onChange({ ...values, [field.name]: value }),
            })}

            {error !== undefined && <span className="field-error">{error}</span>}
          </label>
        );
      })}
    </>
  );
}
