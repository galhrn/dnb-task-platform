import { beforeEach, describe, expect, it } from 'vitest';

import { TASK_TYPE_DEFINITIONS } from '../../domain/task-types/index';
import { TaskTypeRegistry } from '../../domain/task-types/registry';
import {
  InvalidTransitionError,
  TaskClosedError,
  TaskNotFoundError,
  TaskTypeNotFoundError,
  UserNotFoundError,
  ValidationFailedError,
  VersionConflictError,
} from '../../domain/workflow/errors';
import {
  demoUser,
  InMemoryDatabase,
  InMemoryTaskRepository,
  InMemoryUnitOfWork,
} from '../testing/in-memory-repositories';
import { ChangeTaskStatusUseCase } from './change-task-status';
import { CloseTaskUseCase } from './close-task';
import { CreateTaskUseCase } from './create-task';

/**
 * The write use cases, against fakes. No container, no HTTP - what is under test is
 * orchestration: what runs in which order, what the transaction boundary covers, and
 * which error the caller gets when more than one thing is wrong.
 */

const ALICE = 'user-alice';
const BOB = 'user-bob';
const QUOTES = { quotes: ['Supplier A - 100', 'Supplier B - 90'] };

/** Deliberately not a plausible registry key, so it cannot become one. */
const NEVER_REGISTERED = 'NO_SUCH_TASK_TYPE';
const RECEIPT = { receipt: 'INV-2026-001' };

const registry = new TaskTypeRegistry(TASK_TYPE_DEFINITIONS);

let db: InMemoryDatabase;
let create: CreateTaskUseCase;
let changeStatus: ChangeTaskStatusUseCase;
let close: CloseTaskUseCase;

beforeEach(() => {
  db = new InMemoryDatabase().withUsers(demoUser(ALICE, 'Ada'), demoUser(BOB, 'Grace'));

  const unitOfWork = new InMemoryUnitOfWork(db);

  create = new CreateTaskUseCase(registry, unitOfWork);
  changeStatus = new ChangeTaskStatusUseCase(registry, unitOfWork);
  close = new CloseTaskUseCase(registry, unitOfWork);
});

async function procurementAtStatus(status: number) {
  let task = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

  if (status >= 2) {
    task = await changeStatus.execute({
      taskId: task.id,
      toStatus: 2,
      assignedUserId: ALICE,
      data: QUOTES,
    });
  }

  if (status >= 3) {
    task = await changeStatus.execute({
      taskId: task.id,
      toStatus: 3,
      assignedUserId: ALICE,
      data: RECEIPT,
    });
  }

  return task;
}

describe('CreateTaskUseCase', () => {
  it('creates an open task at status 1 with its CREATE history row', async () => {
    const task = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

    expect(task).toMatchObject({
      type: 'PROCUREMENT',
      status: 1,
      state: 'OPEN',
      assignedUserId: ALICE,
      data: {},
      version: 1,
    });

    expect(db.transitionsFor(task.id)).toHaveLength(1);
    expect(db.transitionsFor(task.id)[0]).toMatchObject({ kind: 'CREATE', toStatus: 1 });
  });

  it('rejects an unknown task type as NOT_FOUND, without touching the database', async () => {
    await expect(
      create.execute({ type: NEVER_REGISTERED, assignedUserId: ALICE }),
    ).rejects.toBeInstanceOf(TaskTypeNotFoundError);

    expect(db.tasks.size).toBe(0);
  });

  it('rejects an unknown assignee as NOT_FOUND and writes nothing', async () => {
    await expect(
      create.execute({ type: 'PROCUREMENT', assignedUserId: 'user-ghost' }),
    ).rejects.toBeInstanceOf(UserNotFoundError);

    expect(db.tasks.size).toBe(0);
    expect(db.transitions).toHaveLength(0);
  });
});

describe('ChangeTaskStatusUseCase', () => {
  it('moves forward, records the next assignee and stores the payload by status', async () => {
    const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

    const moved = await changeStatus.execute({
      taskId: created.id,
      toStatus: 2,
      assignedUserId: BOB,
      data: QUOTES,
    });

    expect(moved).toMatchObject({ status: 2, assignedUserId: BOB, version: 2 });
    expect(moved.data).toEqual({ '2': QUOTES });
    expect(db.transitionsFor(created.id).map((entry) => entry.kind)).toEqual([
      'CREATE',
      'FORWARD',
    ]);
  });

  it('moves backward, clears forward data and keeps the history', async () => {
    const atThree = await procurementAtStatus(3);

    const moved = await changeStatus.execute({
      taskId: atThree.id,
      toStatus: 2,
      assignedUserId: BOB,
    });

    expect(moved.status).toBe(2);
    expect(moved.data).toEqual({ '2': QUOTES });

    const history = db.transitionsFor(atThree.id);

    expect(history.map((entry) => entry.kind)).toEqual([
      'CREATE',
      'FORWARD',
      'FORWARD',
      'BACKWARD',
    ]);
    expect(history[2]?.payload).toEqual(RECEIPT);
  });

  it('reports an unknown task as NOT_FOUND', async () => {
    await expect(
      changeStatus.execute({ taskId: 'task-ghost', toStatus: 2, assignedUserId: BOB }),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it('passes the workflow rules straight through', async () => {
    const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

    await expect(
      changeStatus.execute({ taskId: created.id, toStatus: 3, assignedUserId: BOB }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);

    await expect(
      changeStatus.execute({ taskId: created.id, toStatus: 2, assignedUserId: BOB }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('refuses to move a closed task', async () => {
    const atThree = await procurementAtStatus(3);
    await close.execute({ taskId: atThree.id });

    await expect(
      changeStatus.execute({ taskId: atThree.id, toStatus: 2, assignedUserId: BOB }),
    ).rejects.toBeInstanceOf(TaskClosedError);
  });

  it('rejects an unknown assignee as NOT_FOUND', async () => {
    const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

    await expect(
      changeStatus.execute({
        taskId: created.id,
        toStatus: 2,
        assignedUserId: 'user-ghost',
        data: QUOTES,
      }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('prefers the workflow error when the move is illegal AND the assignee is unknown', async () => {
    const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

    // Skipping a status is decided by the engine, for free, before any second query.
    await expect(
      changeStatus.execute({ taskId: created.id, toStatus: 3, assignedUserId: 'user-ghost' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('rolls back completely when the move is refused', async () => {
    const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });
    const before = { version: created.version, history: db.transitionsFor(created.id).length };

    await expect(
      changeStatus.execute({ taskId: created.id, toStatus: 2, assignedUserId: BOB }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    expect(db.tasks.get(created.id)?.version).toBe(before.version);
    expect(db.tasks.get(created.id)?.status).toBe(1);
    expect(db.transitionsFor(created.id)).toHaveLength(before.history);
  });

  describe('concurrency (ADR-015)', () => {
    it('rejects a stale expectedVersion before doing any work', async () => {
      const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

      await expect(
        changeStatus.execute({
          taskId: created.id,
          toStatus: 2,
          assignedUserId: BOB,
          data: QUOTES,
          expectedVersion: 99,
        }),
      ).rejects.toBeInstanceOf(VersionConflictError);

      expect(db.tasks.get(created.id)?.status).toBe(1);
    });

    it('accepts a matching expectedVersion', async () => {
      const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

      const moved = await changeStatus.execute({
        taskId: created.id,
        toStatus: 2,
        assignedUserId: BOB,
        data: QUOTES,
        expectedVersion: created.version,
      });

      expect(moved.status).toBe(2);
    });

    it('guards the write even when the caller sent no expectedVersion', async () => {
      const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE });

      // Somebody else moves the task after this request read it.
      const raced = new InMemoryTaskRepository(db);
      await raced.applyTransition(
        { ...created, status: 2, data: { '2': QUOTES } },
        {
          fromStatus: 1,
          toStatus: 2,
          kind: 'FORWARD',
          payload: QUOTES,
          assignedUserId: BOB,
        },
      );

      await expect(
        new InMemoryTaskRepository(db).applyTransition(
          { ...created, status: 2, data: { '2': QUOTES } },
          {
            fromStatus: 1,
            toStatus: 2,
            kind: 'FORWARD',
            payload: QUOTES,
            assignedUserId: ALICE,
          },
        ),
      ).rejects.toBeInstanceOf(VersionConflictError);
    });
  });
});

describe('CloseTaskUseCase', () => {
  it('closes at the final status and leaves the task where it is (ADR-011)', async () => {
    const atThree = await procurementAtStatus(3);

    const closed = await close.execute({ taskId: atThree.id });

    expect(closed).toMatchObject({ state: 'CLOSED', status: 3, assignedUserId: ALICE });

    expect(db.transitionsFor(atThree.id).at(-1)).toMatchObject({
      kind: 'CLOSE',
      fromStatus: 3,
      toStatus: null,
      assignedUserId: ALICE,
    });
  });

  it('refuses to close before the final status', async () => {
    const atTwo = await procurementAtStatus(2);

    await expect(close.execute({ taskId: atTwo.id })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it('refuses to close twice', async () => {
    const atThree = await procurementAtStatus(3);
    await close.execute({ taskId: atThree.id });

    await expect(close.execute({ taskId: atThree.id })).rejects.toBeInstanceOf(TaskClosedError);
  });

  it('reports an unknown task as NOT_FOUND and honours expectedVersion', async () => {
    await expect(close.execute({ taskId: 'task-ghost' })).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );

    const atThree = await procurementAtStatus(3);

    await expect(
      close.execute({ taskId: atThree.id, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });
});
