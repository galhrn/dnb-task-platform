import { describe, expect, it } from 'vitest';

import { TaskTypeNotFoundError } from '../workflow/errors';
import { developmentTaskType } from './development.task-type';
import { procurementTaskType } from './procurement.task-type';
import { TaskTypeConfigurationError, TaskTypeRegistry } from './registry';
import type { TaskTypeDefinition } from './task-type-definition';

const definitions = [procurementTaskType, developmentTaskType];

describe('lookup', () => {
  const registry = new TaskTypeRegistry(definitions);

  it('finds a registered type', () => {
    expect(registry.get('PROCUREMENT')).toBe(procurementTaskType);
    expect(registry.has('DEVELOPMENT')).toBe(true);
  });

  it('reports an unknown type as NOT_FOUND', () => {
    expect(registry.has('NO_SUCH_TASK_TYPE')).toBe(false);

    try {
      registry.get('NO_SUCH_TASK_TYPE');
      expect.unreachable('the lookup should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(TaskTypeNotFoundError);
      expect((error as TaskTypeNotFoundError).code).toBe('NOT_FOUND');
    }
  });

  it('lists everything it holds', () => {
    expect(registry.list().map((definition) => definition.type)).toEqual([
      'PROCUREMENT',
      'DEVELOPMENT',
    ]);
  });

  it('derives the final status from the ladder', () => {
    expect(registry.finalStatusOf('PROCUREMENT')).toBe(3);
    expect(registry.finalStatusOf('DEVELOPMENT')).toBe(4);
  });
});

describe('describe() - the metadata behind GET /task-types', () => {
  const described = new TaskTypeRegistry(definitions).describe();

  it('numbers statuses from 1, in order', () => {
    for (const type of described) {
      expect(type.statuses.map((status) => status.value)).toEqual(
        type.statuses.map((_status, index) => index + 1),
      );
    }
  });

  it('carries the field descriptors through untouched, so the client can render them', () => {
    const procurement = described.find((type) => type.type === 'PROCUREMENT');

    expect(procurement?.label).toBe('Procurement');
    expect(procurement?.statuses[1]).toEqual({
      value: 2,
      name: 'Supplier offers received',
      fields: [
        {
          kind: 'string-array',
          name: 'quotes',
          label: 'Supplier quotes',
          required: true,
          minItems: 2,
          maxItems: 2,
          itemMinLength: 1,
        },
      ],
    });
  });

  it('leaves the creation status with no fields to render', () => {
    for (const type of described) {
      expect(type.statuses[0]?.fields).toEqual([]);
    }
  });
});

describe('misconfiguration fails at construction, not at request time', () => {
  const wellFormed: TaskTypeDefinition = {
    type: 'THROWAWAY',
    label: 'Throwaway',
    statuses: [
      { name: 'Created', fields: [] },
      {
        name: 'Reviewed',
        fields: [{ kind: 'string', name: 'reviewer', label: 'Reviewer', required: true }],
      },
    ],
  };

  it('rejects a duplicate registration', () => {
    expect(() => new TaskTypeRegistry([wellFormed, wellFormed])).toThrow(TaskTypeConfigurationError);
  });

  it('rejects an empty ladder', () => {
    expect(() => new TaskTypeRegistry([{ ...wellFormed, statuses: [] }])).toThrow(
      TaskTypeConfigurationError,
    );
  });

  it('rejects entry fields on status 1 - nothing transitions into it (WF-3a)', () => {
    const withCreationFields: TaskTypeDefinition = {
      ...wellFormed,
      statuses: [
        {
          name: 'Created',
          fields: [{ kind: 'string', name: 'why', label: 'Why', required: true }],
        },
        ...wellFormed.statuses.slice(1),
      ],
    };

    expect(() => new TaskTypeRegistry([withCreationFields])).toThrow(TaskTypeConfigurationError);
  });

  it('rejects a field declared twice in one status', () => {
    const duplicated: TaskTypeDefinition = {
      ...wellFormed,
      statuses: [
        { name: 'Created', fields: [] },
        {
          name: 'Reviewed',
          fields: [
            { kind: 'string', name: 'reviewer', label: 'Reviewer', required: true },
            { kind: 'string', name: 'reviewer', label: 'Reviewer again', required: false },
          ],
        },
      ],
    };

    expect(() => new TaskTypeRegistry([duplicated])).toThrow(TaskTypeConfigurationError);
  });

  it('rejects blank type keys and unnamed statuses', () => {
    expect(() => new TaskTypeRegistry([{ ...wellFormed, type: '  ' }])).toThrow(
      TaskTypeConfigurationError,
    );

    expect(
      () => new TaskTypeRegistry([{ ...wellFormed, statuses: [{ name: '', fields: [] }] }]),
    ).toThrow(TaskTypeConfigurationError);
  });

  it('is a plain Error, not a DomainError - it can never reach a client', () => {
    const failure = new TaskTypeConfigurationError('boom');

    expect(failure).toBeInstanceOf(Error);
    expect('code' in failure).toBe(false);
  });
});
