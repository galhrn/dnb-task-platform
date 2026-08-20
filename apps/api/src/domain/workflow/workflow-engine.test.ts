import { describe, expect, it } from 'vitest';

import { developmentTaskType } from '../task-types/development.task-type';
import { procurementTaskType } from '../task-types/procurement.task-type';
import type { TaskSnapshot } from '../task';
import { InvalidTransitionError, TaskClosedError, ValidationFailedError } from './errors';
import { changeTaskStatus, closeTask, createTask } from './workflow-engine';

/**
 * One suite per rule in project_context.md section 6. Every test here runs without a
 * database, an HTTP server or a container - which is the point of the layer.
 */

const ALICE = 'user-alice';
const BOB = 'user-bob';

const QUOTES = { quotes: ['Supplier A - 100', 'Supplier B - 90'] };
const RECEIPT = { receipt: 'INV-2026-001' };

function procurementTaskAt(status: number, overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: 'task-1',
    type: 'PROCUREMENT',
    status,
    state: 'OPEN',
    assignedUserId: ALICE,
    data: {},
    version: 1,
    ...overrides,
  };
}

/** A procurement task that has legitimately reached status 3, data and all. */
function completedProcurementTask(): TaskSnapshot {
  return procurementTaskAt(3, { data: { '2': QUOTES, '3': RECEIPT } });
}

describe('WF-1 - a task is assigned to exactly one user at any moment', () => {
  it('creation names the assignee', () => {
    const { task, transition } = createTask(procurementTaskType, { assignedUserId: ALICE });

    expect(task.assignedUserId).toBe(ALICE);
    expect(transition.assignedUserId).toBe(ALICE);
  });

  it('rejects creation without an assignee', () => {
    expect(() => createTask(procurementTaskType, { assignedUserId: '   ' })).toThrow(
      ValidationFailedError,
    );
  });

  it('hands the task to the next assignee on a forward move', () => {
    const { task } = changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
      toStatus: 2,
      assignedUserId: BOB,
      data: QUOTES,
    });

    expect(task.assignedUserId).toBe(BOB);
  });
});

describe('WF-2 - closed tasks are immutable', () => {
  const closed = procurementTaskAt(3, { state: 'CLOSED', data: { '2': QUOTES, '3': RECEIPT } });

  it('refuses a forward move on a closed task', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, closed, { toStatus: 2, assignedUserId: BOB }),
    ).toThrow(TaskClosedError);
  });

  it('refuses a backward move on a closed task', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, closed, { toStatus: 1, assignedUserId: BOB }),
    ).toThrow(TaskClosedError);
  });

  it('reports TASK_CLOSED, not INVALID_TRANSITION', () => {
    try {
      changeTaskStatus(procurementTaskType, closed, { toStatus: 2, assignedUserId: BOB });
      expect.unreachable('the move should have been rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(TaskClosedError);
      expect((error as TaskClosedError).code).toBe('TASK_CLOSED');
    }
  });
});

describe('WF-3 - status is an ascending integer starting at 1', () => {
  it('creates at status 1, open, with no data', () => {
    const { task, transition } = createTask(procurementTaskType, { assignedUserId: ALICE });

    expect(task.status).toBe(1);
    expect(task.state).toBe('OPEN');
    expect(task.data).toEqual({});
    expect(transition).toMatchObject({ fromStatus: null, toStatus: 1, kind: 'CREATE', payload: {} });
  });

  it.each([0, -1, 4, 99])('rejects out-of-range status %i', (toStatus) => {
    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(1), { toStatus, assignedUserId: BOB }),
    ).toThrow(InvalidTransitionError);
  });

  it('rejects a non-integer status', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
        toStatus: 2.5,
        assignedUserId: BOB,
      }),
    ).toThrow(InvalidTransitionError);
  });

  it('derives the range from the type, so a longer ladder allows a higher status', () => {
    const developmentTask: TaskSnapshot = {
      ...procurementTaskAt(3),
      type: 'DEVELOPMENT',
      data: { '2': { specification: 'spec' }, '3': { branchName: 'feat/x' } },
    };

    const { task } = changeTaskStatus(developmentTaskType, developmentTask, {
      toStatus: 4,
      assignedUserId: BOB,
      data: { version: '1.0.0' },
    });

    expect(task.status).toBe(4);
  });
});

describe('WF-4 - forward moves are sequential, exactly +1', () => {
  it('allows 1 -> 2', () => {
    const { task, transition } = changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
      toStatus: 2,
      assignedUserId: BOB,
      data: QUOTES,
    });

    expect(task.status).toBe(2);
    expect(transition.kind).toBe('FORWARD');
  });

  it('refuses to skip 1 -> 3', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
        toStatus: 3,
        assignedUserId: BOB,
        data: RECEIPT,
      }),
    ).toThrow(InvalidTransitionError);
  });

  it('WF-4a - refuses a move to the current status', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(2, { data: { '2': QUOTES } }), {
        toStatus: 2,
        assignedUserId: BOB,
      }),
    ).toThrow(InvalidTransitionError);
  });
});

describe('WF-5 - backward moves are unrestricted in distance', () => {
  it('allows 3 -> 1 in one step', () => {
    const { task, transition } = changeTaskStatus(procurementTaskType, completedProcurementTask(), {
      toStatus: 1,
      assignedUserId: BOB,
    });

    expect(task.status).toBe(1);
    expect(transition.kind).toBe('BACKWARD');
  });

  it('allows 3 -> 2', () => {
    const { task } = changeTaskStatus(procurementTaskType, completedProcurementTask(), {
      toStatus: 2,
      assignedUserId: BOB,
    });

    expect(task.status).toBe(2);
  });
});

describe('WF-6 - a task may be closed only at its final status', () => {
  it('closes at status 3 for procurement', () => {
    const { task, transition } = closeTask(procurementTaskType, completedProcurementTask());

    expect(task.state).toBe('CLOSED');
    expect(task.status).toBe(3);
    expect(transition).toMatchObject({ fromStatus: 3, toStatus: null, kind: 'CLOSE' });
  });

  it('refuses to close before the final status', () => {
    expect(() =>
      closeTask(procurementTaskType, procurementTaskAt(2, { data: { '2': QUOTES } })),
    ).toThrow(InvalidTransitionError);
  });

  it('derives the final status from the type - status 3 is not final for development', () => {
    const developmentTask: TaskSnapshot = { ...completedProcurementTask(), type: 'DEVELOPMENT' };

    expect(() => closeTask(developmentTaskType, developmentTask)).toThrow(InvalidTransitionError);
  });

  it('WF-6a - closing a closed task is an error, not idempotent success', () => {
    const closed: TaskSnapshot = { ...completedProcurementTask(), state: 'CLOSED' };

    expect(() => closeTask(procurementTaskType, closed)).toThrow(TaskClosedError);
  });

  it('WF-6b - closing keeps the current assignee and asks for no other', () => {
    const { task, transition } = closeTask(procurementTaskType, completedProcurementTask());

    expect(task.assignedUserId).toBe(ALICE);
    expect(transition.assignedUserId).toBe(ALICE);
  });
});

describe('WF-7 - every status change satisfies the data requirements and records the assignee', () => {
  it('refuses a forward move with no data when the target status requires some', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
        toStatus: 2,
        assignedUserId: BOB,
      }),
    ).toThrow(ValidationFailedError);
  });

  it('reports which field failed', () => {
    try {
      changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
        toStatus: 2,
        assignedUserId: BOB,
        data: { quotes: ['only one'] },
      });
      expect.unreachable('the move should have been rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      const failure = error as ValidationFailedError;
      expect(failure.code).toBe('VALIDATION_FAILED');
      expect(failure.details.map((detail) => detail.path)).toContain('data.quotes');
    }
  });

  it('rejects data the type never declared', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
        toStatus: 2,
        assignedUserId: BOB,
        data: { ...QUOTES, sneaky: 'value' },
      }),
    ).toThrow(ValidationFailedError);
  });

  it('refuses a move with no assignee, in both directions', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
        toStatus: 2,
        assignedUserId: '',
        data: QUOTES,
      }),
    ).toThrow(ValidationFailedError);

    expect(() =>
      changeTaskStatus(procurementTaskType, completedProcurementTask(), {
        toStatus: 1,
        assignedUserId: '  ',
      }),
    ).toThrow(ValidationFailedError);
  });

  it('WF-7a - requirements are scoped to entering a status, so status 1 needs nothing', () => {
    const { task } = changeTaskStatus(procurementTaskType, completedProcurementTask(), {
      toStatus: 1,
      assignedUserId: BOB,
    });

    expect(task.status).toBe(1);
  });

  it('stores the accepted payload under the status it belongs to', () => {
    const { task, transition } = changeTaskStatus(procurementTaskType, procurementTaskAt(1), {
      toStatus: 2,
      assignedUserId: BOB,
      data: QUOTES,
    });

    expect(task.data).toEqual({ '2': QUOTES });
    expect(transition.payload).toEqual(QUOTES);
  });

  it('trims what it stores, and rejects whitespace-only values', () => {
    const { task } = changeTaskStatus(
      procurementTaskType,
      procurementTaskAt(2, { data: { '2': QUOTES } }),
      { toStatus: 3, assignedUserId: BOB, data: { receipt: '  INV-9  ' } },
    );

    expect(task.data['3']).toEqual({ receipt: 'INV-9' });

    expect(() =>
      changeTaskStatus(procurementTaskType, procurementTaskAt(2, { data: { '2': QUOTES } }), {
        toStatus: 3,
        assignedUserId: BOB,
        data: { receipt: '   ' },
      }),
    ).toThrow(ValidationFailedError);
  });
});

describe('WF-7b - a backward move clears the data collected beyond its target', () => {
  it('3 -> 2 drops the status 3 payload and keeps status 2', () => {
    const { task } = changeTaskStatus(procurementTaskType, completedProcurementTask(), {
      toStatus: 2,
      assignedUserId: BOB,
    });

    expect(task.data).toEqual({ '2': QUOTES });
  });

  it('3 -> 1 drops everything', () => {
    const { task } = changeTaskStatus(procurementTaskType, completedProcurementTask(), {
      toStatus: 1,
      assignedUserId: BOB,
    });

    expect(task.data).toEqual({});
  });

  it('re-advancing demands the cleared data again', () => {
    const { task: backAtTwo } = changeTaskStatus(procurementTaskType, completedProcurementTask(), {
      toStatus: 2,
      assignedUserId: BOB,
    });

    expect(() =>
      changeTaskStatus(procurementTaskType, backAtTwo, { toStatus: 3, assignedUserId: ALICE }),
    ).toThrow(ValidationFailedError);

    const { task: forwardAgain } = changeTaskStatus(procurementTaskType, backAtTwo, {
      toStatus: 3,
      assignedUserId: ALICE,
      data: { receipt: 'INV-REPLACED' },
    });

    expect(forwardAgain.data).toEqual({ '2': QUOTES, '3': { receipt: 'INV-REPLACED' } });
  });

  it('refuses data supplied on a backward move (ADR-006)', () => {
    expect(() =>
      changeTaskStatus(procurementTaskType, completedProcurementTask(), {
        toStatus: 2,
        assignedUserId: BOB,
        data: QUOTES,
      }),
    ).toThrow(ValidationFailedError);
  });

  it('records an empty payload on the backward transition', () => {
    const { transition } = changeTaskStatus(procurementTaskType, completedProcurementTask(), {
      toStatus: 2,
      assignedUserId: BOB,
    });

    expect(transition).toMatchObject({
      fromStatus: 3,
      toStatus: 2,
      kind: 'BACKWARD',
      payload: {},
      assignedUserId: BOB,
    });
  });
});

describe('engine hygiene', () => {
  it('never mutates the snapshot it was given', () => {
    const before = completedProcurementTask();
    const frozen = structuredClone(before);

    changeTaskStatus(procurementTaskType, before, { toStatus: 2, assignedUserId: BOB });
    closeTask(procurementTaskType, before);

    expect(before).toEqual(frozen);
  });

  it('leaves the version untouched - concurrency belongs to persistence (ADR-010)', () => {
    const { task } = changeTaskStatus(procurementTaskType, procurementTaskAt(1, { version: 7 }), {
      toStatus: 2,
      assignedUserId: BOB,
      data: QUOTES,
    });

    expect(task.version).toBe(7);
  });

  it('treats a task evaluated against the wrong definition as a wiring bug, not a 4xx', () => {
    expect(() =>
      changeTaskStatus(developmentTaskType, procurementTaskAt(1), {
        toStatus: 2,
        assignedUserId: BOB,
        data: { specification: 'spec' },
      }),
    ).toThrow(/was evaluated against/);
  });
});
