import type { FieldDescriptor } from '@task-platform/contracts';
import { describe, expect, it } from 'vitest';

import { compileStatusSchema } from './field-schema';

/**
 * The descriptor vocabulary (ADR-009). These tests pin the meaning of each descriptor,
 * because every task type - present and future - inherits that meaning for free.
 */

function parse(fields: readonly FieldDescriptor[], input: unknown) {
  return compileStatusSchema(fields).safeParse(input);
}

const requiredText: FieldDescriptor = {
  kind: 'string',
  name: 'receipt',
  label: 'Receipt',
  required: true,
};

describe('string descriptors', () => {
  it('accepts text and trims it', () => {
    const result = parse([requiredText], { receipt: '  INV-1  ' });

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ receipt: 'INV-1' });
  });

  it('treats a required string as non-empty by default', () => {
    expect(parse([requiredText], { receipt: '' }).success).toBe(false);
    expect(parse([requiredText], { receipt: '   ' }).success).toBe(false);
  });

  it('rejects a missing required field and a non-string value', () => {
    expect(parse([requiredText], {}).success).toBe(false);
    expect(parse([requiredText], { receipt: 42 }).success).toBe(false);
  });

  it('allows an optional field to be absent', () => {
    const optional: FieldDescriptor = { ...requiredText, required: false };

    expect(parse([optional], {}).success).toBe(true);
  });

  it('honours minLength and maxLength', () => {
    const bounded: FieldDescriptor = { ...requiredText, minLength: 3, maxLength: 5 };

    expect(parse([bounded], { receipt: 'ab' }).success).toBe(false);
    expect(parse([bounded], { receipt: 'abc' }).success).toBe(true);
    expect(parse([bounded], { receipt: 'abcdef' }).success).toBe(false);
  });
});

describe('number descriptors', () => {
  const score: FieldDescriptor = {
    kind: 'number',
    name: 'score',
    label: 'Score',
    required: true,
    min: 1,
    max: 5,
  };

  it('accepts a number inside the range', () => {
    expect(parse([score], { score: 3 }).success).toBe(true);
  });

  it('rejects values outside the range', () => {
    expect(parse([score], { score: 0 }).success).toBe(false);
    expect(parse([score], { score: 6 }).success).toBe(false);
  });

  it('rejects numeric strings, NaN and Infinity', () => {
    expect(parse([score], { score: '3' }).success).toBe(false);
    expect(parse([score], { score: Number.NaN }).success).toBe(false);
    expect(parse([score], { score: Number.POSITIVE_INFINITY }).success).toBe(false);
  });
});

describe('string-array descriptors', () => {
  const quotes: FieldDescriptor = {
    kind: 'string-array',
    name: 'quotes',
    label: 'Supplier quotes',
    required: true,
    minItems: 2,
    maxItems: 2,
    itemMinLength: 1,
  };

  it('accepts exactly the required number of entries', () => {
    expect(parse([quotes], { quotes: ['a', 'b'] }).success).toBe(true);
  });

  it('rejects too few and too many entries', () => {
    expect(parse([quotes], { quotes: ['a'] }).success).toBe(false);
    expect(parse([quotes], { quotes: ['a', 'b', 'c'] }).success).toBe(false);
  });

  it('rejects empty entries and non-list values', () => {
    expect(parse([quotes], { quotes: ['a', '   '] }).success).toBe(false);
    expect(parse([quotes], { quotes: 'a,b' }).success).toBe(false);
  });

  it('points at the offending index', () => {
    const result = parse([quotes], { quotes: ['a', ''] });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['quotes', 1]);
  });
});

describe('the status schema as a whole', () => {
  it('rejects keys the type never declared', () => {
    expect(parse([requiredText], { receipt: 'INV-1', extra: true }).success).toBe(false);
  });

  it('accepts nothing at all when a status declares no fields', () => {
    expect(parse([], {}).success).toBe(true);
    expect(parse([], { anything: 1 }).success).toBe(false);
  });
});
