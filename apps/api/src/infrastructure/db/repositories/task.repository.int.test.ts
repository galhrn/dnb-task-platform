import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { procurementTaskType } from '../../../domain/task-types/procurement.task-type';
import { TaskNotFoundError, VersionConflictError } from '../../../domain/workflow/errors';
import { changeTaskStatus, closeTask, createTask } from '../../../domain/workflow/workflow-engine';
import { AppDataSource } from '../data-source';
import { TaskEntity } from '../entities/task.entity';
import { TaskTransitionEntity } from '../entities/task-transition.entity';
import { UserEntity } from '../entities/user.entity';
import { runTaskRepositoryContract } from '../../../application/testing/task-repository.contract';
import { TypeOrmTaskRepository } from './typeorm-task.repository';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

/**
 * Requires `npm run db:up` and `npm run migration:run`.
 *
 * These tests exist because the interesting parts of this layer cannot be verified with a
 * double: whether the version guard really refuses a stale write, whether a rollback
 * really removes the history row, whether JSONB really round-trips a nested structure.
 * A mocked repository would agree with whatever we assumed.
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

const QUOTES = { quotes: ['Supplier A - 100', 'Supplier B - 90'] };
const RECEIPT = { receipt: 'INV-2026-001' };

let unitOfWork: TypeOrmUnitOfWork;

beforeAll(async () => {
  await AppDataSource.initialize();
  unitOfWork = new TypeOrmUnitOfWork(AppDataSource);

  await AppDataSource.createQueryBuilder()
    .insert()
    .into(UserEntity)
    .values([
      { id: ALICE, name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: BOB, name: 'Grace Hopper', email: 'grace@example.com' },
    ])
    .orIgnore()
    .execute();
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

beforeEach(async () => {
  // Truncate rather than delete: TypeORM refuses an empty delete criteria, and CASCADE
  // takes the history rows with the tasks. Seeded users are left in place.
  await AppDataSource.query('TRUNCATE TABLE "tasks" CASCADE');
});

function repository() {
  return new TypeOrmTaskRepository(AppDataSource.manager);
}

async function seedTaskAtStatusOne() {
  const { task, transition } = createTask(procurementTaskType, { assignedUserId: ALICE, actorUserId: ALICE });

  return repository().create(task, transition);
}

describe('create', () => {
  it('persists the task and its CREATE history row', async () => {
    const created = await seedTaskAtStatusOne();

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toMatchObject({
      type: 'PROCUREMENT',
      status: 1,
      state: 'OPEN',
      assignedUserId: ALICE,
      data: {},
      version: 1,
    });

    const found = await repository().findByIdWithHistory(created.id);

    expect(found?.transitions).toHaveLength(1);
    expect(found?.transitions[0]).toMatchObject({
      fromStatus: null,
      toStatus: 1,
      kind: 'CREATE',
      assignedUserId: ALICE,
    });
  });

  it('returns null for a task that does not exist', async () => {
    expect(await repository().findById('44444444-4444-4444-8444-444444444444')).toBeNull();
  });
});

describe('applyTransition', () => {
  it('round-trips the JSONB projection keyed by status', async () => {
    const created = await seedTaskAtStatusOne();
    const { task: next, transition } = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });

    const saved = await repository().applyTransition(next, transition);

    expect(saved.data).toEqual({ '2': QUOTES });
    expect((await repository().findById(created.id))?.data).toEqual({ '2': QUOTES });
  });

  it('bumps the version on every write', async () => {
    const created = await seedTaskAtStatusOne();
    const { task: next, transition } = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });

    expect(created.version).toBe(1);
    expect((await repository().applyTransition(next, transition)).version).toBe(2);
  });

  it('appends history in order without ever rewriting it', async () => {
    const created = await seedTaskAtStatusOne();

    const forward = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });
    const atTwo = await repository().applyTransition(forward.task, forward.transition);

    const backward = changeTaskStatus(procurementTaskType, atTwo, {
      toStatus: 1,
      assignedUserId: ALICE,
      actorUserId: ALICE,
    });
    await repository().applyTransition(backward.task, backward.transition);

    const found = await repository().findByIdWithHistory(created.id);

    expect(found?.transitions.map((entry) => entry.kind)).toEqual([
      'CREATE',
      'FORWARD',
      'BACKWARD',
    ]);

    // WF-7b wiped the projection, but what was collected is still in the log.
    expect(found?.task.data).toEqual({});
    expect(found?.transitions[1]?.payload).toEqual(QUOTES);
  });

  it('records the assignee on CLOSE even though closing names no new one (ADR-011)', async () => {
    const created = await seedTaskAtStatusOne();

    const toTwo = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });
    const atTwo = await repository().applyTransition(toTwo.task, toTwo.transition);

    const toThree = changeTaskStatus(procurementTaskType, atTwo, {
      toStatus: 3,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: RECEIPT,
    });
    const atThree = await repository().applyTransition(toThree.task, toThree.transition);

    const closed = closeTask(procurementTaskType, atThree, ALICE);
    const saved = await repository().applyTransition(closed.task, closed.transition);

    expect(saved.state).toBe('CLOSED');

    const history = await repository().findByIdWithHistory(created.id);

    expect(history?.transitions.at(-1)).toMatchObject({
      kind: 'CLOSE',
      fromStatus: 3,
      toStatus: null,
      assignedUserId: BOB,
    });
  });
});

describe('optimistic locking (ADR-010, ADR-015)', () => {
  it('refuses a write built on a version that has since moved', async () => {
    const created = await seedTaskAtStatusOne();

    // Two callers read the same task, then both try to move it.
    const first = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });
    const second = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: ALICE,
      actorUserId: ALICE,
      data: QUOTES,
    });

    await repository().applyTransition(first.task, first.transition);

    await expect(
      repository().applyTransition(second.task, second.transition),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('reports the versions it saw', async () => {
    const created = await seedTaskAtStatusOne();
    const move = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });

    await repository().applyTransition(move.task, move.transition);

    const failure = await repository()
      .applyTransition(move.task, move.transition)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(VersionConflictError);
    expect((failure as VersionConflictError).code).toBe('VERSION_CONFLICT');
    expect((failure as VersionConflictError).message).toContain('expected version 1');
    expect((failure as VersionConflictError).message).toContain('found 2');
  });

  it('reports a vanished task as NOT_FOUND rather than a conflict', async () => {
    const created = await seedTaskAtStatusOne();
    const move = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });

    await AppDataSource.getRepository(TaskEntity).delete({ id: created.id });

    await expect(
      repository().applyTransition(move.task, move.transition),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it('leaves no history row behind when the write is refused', async () => {
    const created = await seedTaskAtStatusOne();
    const move = changeTaskStatus(procurementTaskType, created, {
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });

    await repository().applyTransition(move.task, move.transition);
    await repository()
      .applyTransition(move.task, move.transition)
      .catch(() => undefined);

    const rows = await AppDataSource.getRepository(TaskTransitionEntity).countBy({
      taskId: created.id,
    });

    expect(rows).toBe(2);
  });
});

describe('the unit of work', () => {
  it('commits the task and its history together', async () => {
    const id = await unitOfWork.runInTransaction(async ({ tasks }) => {
      const { task, transition } = createTask(procurementTaskType, { assignedUserId: ALICE, actorUserId: ALICE });

      return (await tasks.create(task, transition)).id;
    });

    expect(await repository().findById(id)).not.toBeNull();
    expect(
      await AppDataSource.getRepository(TaskTransitionEntity).countBy({ taskId: id }),
    ).toBe(1);
  });

  it('rolls both back when the work throws - a refused move leaves no trace', async () => {
    const before = await AppDataSource.getRepository(TaskEntity).count();

    await expect(
      unitOfWork.runInTransaction(async ({ tasks }) => {
        const { task, transition } = createTask(procurementTaskType, { assignedUserId: ALICE, actorUserId: ALICE });
        const created = await tasks.create(task, transition);

        // Exactly what the engine does when a caller tries to skip a status.
        changeTaskStatus(procurementTaskType, created, {
          toStatus: 3,
          assignedUserId: BOB,
          actorUserId: ALICE,
        });
      }),
    ).rejects.toThrow(/exactly one status/);

    expect(await AppDataSource.getRepository(TaskEntity).count()).toBe(before);
    expect(await AppDataSource.getRepository(TaskTransitionEntity).count()).toBe(0);
  });
});

describe('findByAssignee (ADR-012)', () => {
  it('returns open and closed tasks by default, and narrows on request', async () => {
    const open = await seedTaskAtStatusOne();

    const closedTask = await seedTaskAtStatusOne();
    const toTwo = changeTaskStatus(procurementTaskType, closedTask, {
      toStatus: 2,
      assignedUserId: ALICE,
      actorUserId: ALICE,
      data: QUOTES,
    });
    const atTwo = await repository().applyTransition(toTwo.task, toTwo.transition);
    const toThree = changeTaskStatus(procurementTaskType, atTwo, {
      toStatus: 3,
      assignedUserId: ALICE,
      actorUserId: ALICE,
      data: RECEIPT,
    });
    const atThree = await repository().applyTransition(toThree.task, toThree.transition);
    const closed = closeTask(procurementTaskType, atThree, ALICE);
    await repository().applyTransition(closed.task, closed.transition);

    const everything = await repository().findByAssignee(ALICE);
    const onlyOpen = await repository().findByAssignee(ALICE, 'OPEN');
    const onlyClosed = await repository().findByAssignee(ALICE, 'CLOSED');

    expect(everything).toHaveLength(2);
    expect(onlyOpen.map((task) => task.id)).toEqual([open.id]);
    expect(onlyClosed.map((task) => task.id)).toEqual([closedTask.id]);
  });

  it('does not return another user’s tasks', async () => {
    await seedTaskAtStatusOne();

    expect(await repository().findByAssignee(BOB)).toHaveLength(0);
  });
});

/**
 * The same suite the in-memory doubles are held to, run against Postgres. Fakes that pass
 * a contract the real implementation also passes are safe to unit-test against.
 */
runTaskRepositoryContract('TypeOrmTaskRepository', {
  alice: ALICE,
  bob: BOB,
  setup: async () => {
    await AppDataSource.query('TRUNCATE TABLE "tasks" CASCADE');

    return {
      repository: new TypeOrmTaskRepository(AppDataSource.manager),
      remove: async (taskId: string) => {
        await AppDataSource.getRepository(TaskEntity).delete({ id: taskId });
      },
    };
  },
});
