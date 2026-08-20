import { describe, expect, it } from 'vitest';

import { developmentTaskType } from './development.task-type';
import { procurementTaskType } from './procurement.task-type';
import { TaskTypeRegistry } from './registry';
import { finalStatusOf } from './task-type-definition';
import { TASK_TYPE_DEFINITIONS } from './index';

/**
 * The catalogue in project_context.md section 7, asserted. If the spec tables and these
 * definitions ever disagree, one of them is wrong and this test says so.
 */

function ladderOf(definition: { statuses: readonly { name: string }[] }): string[] {
  return definition.statuses.map((status) => status.name);
}

function fieldNamesAt(
  definition: { statuses: readonly { fields: readonly { name: string }[] }[] },
  status: number,
): string[] {
  return (definition.statuses[status - 1]?.fields ?? []).map((field) => field.name);
}

describe('Procurement', () => {
  it('has the three statuses from the spec', () => {
    expect(procurementTaskType.type).toBe('PROCUREMENT');
    expect(ladderOf(procurementTaskType)).toEqual([
      'Created',
      'Supplier offers received',
      'Purchase completed',
    ]);
    expect(finalStatusOf(procurementTaskType)).toBe(3);
  });

  it('requires two quotes to enter status 2 and a receipt to enter status 3', () => {
    expect(fieldNamesAt(procurementTaskType, 1)).toEqual([]);
    expect(fieldNamesAt(procurementTaskType, 2)).toEqual(['quotes']);
    expect(fieldNamesAt(procurementTaskType, 3)).toEqual(['receipt']);

    const quotes = procurementTaskType.statuses[1]?.fields[0];

    expect(quotes).toMatchObject({ kind: 'string-array', minItems: 2, maxItems: 2 });
  });
});

describe('Development', () => {
  it('has the four statuses from the spec', () => {
    expect(developmentTaskType.type).toBe('DEVELOPMENT');
    expect(ladderOf(developmentTaskType)).toEqual([
      'Created',
      'Specification completed',
      'Development completed',
      'Distribution completed',
    ]);
    expect(finalStatusOf(developmentTaskType)).toBe(4);
  });

  it('requires a specification, a branch name and a version on the way up', () => {
    expect(fieldNamesAt(developmentTaskType, 1)).toEqual([]);
    expect(fieldNamesAt(developmentTaskType, 2)).toEqual(['specification']);
    expect(fieldNamesAt(developmentTaskType, 3)).toEqual(['branchName']);
    expect(fieldNamesAt(developmentTaskType, 4)).toEqual(['version']);
  });

  it('marks the specification multiline so the client renders a textarea without knowing why', () => {
    expect(developmentTaskType.statuses[1]?.fields[0]).toMatchObject({
      kind: 'string',
      multiline: true,
    });
  });
});

describe('the registration list', () => {
  it('holds exactly the two types shipped so far - Marketing arrives at M7 (ADR-008)', () => {
    expect(TASK_TYPE_DEFINITIONS.map((definition) => definition.type)).toEqual([
      'PROCUREMENT',
      'DEVELOPMENT',
    ]);
  });

  it('is well formed, so a misconfigured type would fail the process on boot', () => {
    expect(() => new TaskTypeRegistry(TASK_TYPE_DEFINITIONS)).not.toThrow();
  });

  it('uses camelCase field names throughout (section 15)', () => {
    for (const definition of TASK_TYPE_DEFINITIONS) {
      for (const status of definition.statuses) {
        for (const field of status.fields) {
          expect(field.name).toMatch(/^[a-z][A-Za-z0-9]*$/);
        }
      }
    }
  });
});
