import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The client half of the extensibility claim, asserted rather than promised.
 *
 * The README says adding a task type changes no frontend file. This test is what makes
 * that checkable: it reads every source file in the client and fails if any of them names
 * a task type, names a field that belongs to one, or branches on either. When Marketing
 * arrives at M7 this suite must still pass without being edited - that is the proof.
 *
 * The server has the mirror of this in `domain/purity.test.ts`.
 */

const SOURCE_DIR = __dirname;

/** Registry keys, matched case-insensitively. If a component needs one, the design failed. */
const TASK_TYPE_KEYS = ['PROCUREMENT', 'DEVELOPMENT', 'MARKETING'];

/** Field names owned by a task type, not by the descriptor vocabulary. */
const TYPE_SPECIFIC_FIELDS = ['quotes', 'receipt', 'specification', 'branchName', 'campaignUrl'];

/** Shapes that mean "this code is deciding something per task type". */
const PER_TYPE_BRANCHES = [
  // A type compared to a LITERAL. `descriptor.type === task.type` is the opposite of a
  // per-type branch - it matches a task to whatever the server described - so the quote
  // is the part that matters.
  /type\s*===\s*['"`]/,
  /switch\s*\(\s*[\w.]*type\s*\)/,
  // Ladder lengths and status numbers written as constants: both belong to the descriptor.
  /statuses\.length\s*===\s*\d/,
  /status\s*===\s*[2-9]/,
];

/**
 * Comments are prose, not behaviour - and several of these files legitimately explain, in
 * words, that they know nothing about procurement or marketing. The rules read code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    const isSource = entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');

    return isSource && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sourceFiles(SOURCE_DIR);

function codeOf(name: string): string {
  return stripComments(readFileSync(join(SOURCE_DIR, name), 'utf8'));
}

describe('the client has no task-type knowledge', () => {
  it('is actually looking at the client', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.map((file) => relative(SOURCE_DIR, file)))('%s names no task type', (name) => {
    const code = codeOf(name);

    for (const key of TASK_TYPE_KEYS) {
      expect(new RegExp(key, 'i').test(code), `${name} mentions the task type "${key}"`).toBe(
        false,
      );
    }
  });

  it.each(files.map((file) => relative(SOURCE_DIR, file)))(
    '%s names no type-specific field',
    (name) => {
      const code = codeOf(name);

      for (const field of TYPE_SPECIFIC_FIELDS) {
        expect(
          new RegExp(`['"\`]${field}['"\`]`).test(code),
          `${name} refers to "${field}", which belongs to one task type`,
        ).toBe(false);
      }
    },
  );

  it.each(files.map((file) => relative(SOURCE_DIR, file)))(
    '%s branches on nothing type-specific',
    (name) => {
      const code = codeOf(name);

      for (const pattern of PER_TYPE_BRANCHES) {
        expect(
          pattern.test(code),
          `${name} matches ${String(pattern)} - a per-type conditional`,
        ).toBe(false);
      }
    },
  );

  it('would actually catch a violation - these rules are not vacuous', () => {
    const violations = [
      "if (task.type === 'PROCUREMENT') { renderQuotes(); }",
      'switch (task.type) { case A: break; }',
      'const threeRunged = descriptor.statuses.length === 3;',
      'if (task.status === 3) { showReceiptField(); }',
    ];

    for (const sample of violations) {
      expect(
        PER_TYPE_BRANCHES.some((pattern) => pattern.test(sample)),
        `no rule catches: ${sample}`,
      ).toBe(true);
    }

    // ...while the generic lookups the client genuinely needs stay legal.
    const legitimate = [
      'descriptors.find((descriptor) => descriptor.type === task.type)',
      'const finalStatus = descriptor.statuses.length;',
      'const nextFields = descriptor.statuses[task.status].fields;',
    ];

    for (const sample of legitimate) {
      expect(
        PER_TYPE_BRANCHES.some((pattern) => pattern.test(sample)),
        `a rule wrongly flags: ${sample}`,
      ).toBe(false);
    }
  });

  it('strips comments rather than reading prose as code', () => {
    expect(stripComments('/* mentions PROCUREMENT */ const a = 1;')).not.toContain('PROCUREMENT');
    expect(stripComments('// a MARKETING note\nconst b = 2;')).not.toContain('MARKETING');
    expect(stripComments("const c = 'kept';")).toContain('kept');
  });

  it('renders every field kind the contract declares, so a new type cannot arrive unrenderable', () => {
    const form = readFileSync(join(SOURCE_DIR, 'components', 'DynamicFieldForm.tsx'), 'utf8');

    // The mapped type `{ [K in FieldKind]: FieldRenderer<K> }` already makes a missing
    // kind a compile error; this states the current vocabulary out loud.
    for (const kind of ['string', 'number', 'boolean', 'date', 'string-array']) {
      expect(form.includes(kind), `DynamicFieldForm has no renderer for "${kind}"`).toBe(true);
    }
  });
});
