import { describe, expect, it } from 'vitest';

import { TaskTypeRegistry } from './task-types/registry';
import type { TaskTypeDefinition } from './task-types/task-type-definition';
import { ValidationFailedError } from './workflow/errors';
import { changeTaskStatus, closeTask, createTask } from './workflow/workflow-engine';
import type { TaskSnapshot } from './task';

/**
 * The claim the README leads with, asserted rather than asserted-in-prose: a task type
 * the engine has never seen is registered at runtime and driven through its whole
 * lifecycle. Nothing in domain/workflow changed to make this file pass.
 *
 * Five statuses - a length neither shipped type has - so any bound the engine used
 * other than "the length of this list" would show up here.
 */
const throwawayTaskType: TaskTypeDefinition = {
  type: 'THROWAWAY',
  label: 'Throwaway',
  statuses: [
    { name: 'Created', fields: [] },
    {
      name: 'Reviewed',
      fields: [{ kind: 'string', name: 'reviewer', label: 'Reviewer', required: true }],
    },
    {
      name: 'Scored',
      fields: [{ kind: 'number', name: 'score', label: 'Score', required: true, min: 1, max: 5 }],
    },
    {
      name: 'Tagged',
      fields: [
        { kind: 'string-array', name: 'tags', label: 'Tags', required: true, minItems: 1 },
      ],
    },
    { name: 'Archived', fields: [] },
  ],
};

function newTask(): TaskSnapshot {
  const { task } = createTask(throwawayTaskType, { assignedUserId: 'user-alice', actorUserId: 'user-alice' });

  // Identity and version come from persistence; the engine never invents them.
  return { ...task, id: 'task-throwaway', version: 1 };
}

function advance(task: TaskSnapshot, toStatus: number, data?: Record<string, unknown>) {
  return changeTaskStatus(throwawayTaskType, task, {
    toStatus,
    assignedUserId: 'user-bob',
    actorUserId: 'user-alice',
    ...(data === undefined ? {} : { data }),
  }).task;
}

describe('a task type the engine has never seen', () => {
  it('is accepted by the registry and described for the client', () => {
    const registry = new TaskTypeRegistry([throwawayTaskType]);
    const described = registry.describe();

    expect(registry.finalStatusOf('THROWAWAY')).toBe(5);
    expect(described[0]?.statuses.map((status) => status.value)).toEqual([1, 2, 3, 4, 5]);
    expect(described[0]?.statuses[2]?.fields[0]).toMatchObject({ kind: 'number', name: 'score' });
  });

  it('runs its whole lifecycle through the same engine functions', () => {
    let task = newTask();

    expect(task.status).toBe(1);

    task = advance(task, 2, { reviewer: 'Dana' });
    task = advance(task, 3, { score: 4 });
    task = advance(task, 4, { tags: ['urgent'] });
    task = advance(task, 5);

    expect(task.data).toEqual({
      '2': { reviewer: 'Dana' },
      '3': { score: 4 },
      '4': { tags: ['urgent'] },
      '5': {},
    });

    const { task: closed, transition } = closeTask(throwawayTaskType, task, 'user-alice');

    expect(closed.state).toBe('CLOSED');
    expect(transition).toMatchObject({ fromStatus: 5, toStatus: null, kind: 'CLOSE' });
  });

  it('gets every general rule for free - skipping, closing early, and clear-forward', () => {
    const created = newTask();

    expect(() => advance(created, 3, { score: 4 })).toThrow(/exactly one status/);
    expect(() => closeTask(throwawayTaskType, created, 'user-alice')).toThrow(/status 5/);

    let task = advance(created, 2, { reviewer: 'Dana' });
    task = advance(task, 3, { score: 4 });
    task = advance(task, 2);

    expect(task.data).toEqual({ '2': { reviewer: 'Dana' } });
  });

  it('validates its own fields with no engine involvement', () => {
    const created = newTask();

    expect(() => advance(created, 2, { reviewer: '' })).toThrow(ValidationFailedError);
    expect(() => advance(advance(created, 2, { reviewer: 'Dana' }), 3, { score: 9 })).toThrow(
      ValidationFailedError,
    );
  });
});

describe('the onEnter escape hatch (section 8)', () => {
  /**
   * Two rules no field descriptor can express: one across the fields of a single
   * payload, one across statuses. The engine calls the hook without knowing either.
   */
  const withHook: TaskTypeDefinition = {
    ...throwawayTaskType,
    type: 'THROWAWAY_STRICT',
    onEnter: ({ task, toStatus, data }) => {
      if (toStatus === 3 && task.data['2']?.['reviewer'] === 'Dana') {
        const score = data['score'];

        if (typeof score === 'number' && score < 3) {
          throw new ValidationFailedError("Dana's reviews score at least 3", [
            { path: 'data.score', message: 'Must be at least 3' },
          ]);
        }
      }

      if (toStatus === 4) {
        const tags = data['tags'];

        if (Array.isArray(tags) && new Set(tags).size !== tags.length) {
          throw new ValidationFailedError('Tags must be unique', [
            { path: 'data.tags', message: 'Duplicate tag' },
          ]);
        }
      }
    },
  };

  function drive(task: TaskSnapshot, toStatus: number, data?: Record<string, unknown>) {
    return changeTaskStatus(withHook, task, {
      toStatus,
      assignedUserId: 'user-bob',
      actorUserId: 'user-alice',
      ...(data === undefined ? {} : { data }),
    }).task;
  }

  function started(): TaskSnapshot {
    const { task } = createTask(withHook, { assignedUserId: 'user-alice', actorUserId: 'user-alice' });

    return { ...task, id: 'task-strict', version: 1 };
  }

  it('rejects a cross-field combination the descriptors allow', () => {
    const atThree = drive(drive(started(), 2, { reviewer: 'Dana' }), 3, { score: 4 });

    expect(() => drive(atThree, 4, { tags: ['a', 'a'] })).toThrow(/unique/);
    expect(drive(atThree, 4, { tags: ['a', 'b'] }).status).toBe(4);
  });

  it('can reach back into data collected at an earlier status', () => {
    const reviewedByDana = drive(started(), 2, { reviewer: 'Dana' });

    expect(() => drive(reviewedByDana, 3, { score: 1 })).toThrow(/at least 3/);
    expect(drive(reviewedByDana, 3, { score: 3 }).status).toBe(3);
  });

  it('leaves types without a hook completely unaffected', () => {
    const { task } = createTask(throwawayTaskType, { assignedUserId: 'user-alice', actorUserId: 'user-alice' });
    const plain: TaskSnapshot = { ...task, id: 'task-plain', version: 1 };

    expect(advance(advance(plain, 2, { reviewer: 'Dana' }), 3, { score: 1 }).status).toBe(3);
  });
});
