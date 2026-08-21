import { beforeEach, describe, expect, it } from 'vitest';

import { TASK_TYPE_DEFINITIONS } from '../../domain/task-types/index';
import { TaskTypeRegistry } from '../../domain/task-types/registry';
import { TaskNotFoundError, UserNotFoundError } from '../../domain/workflow/errors';
import {
  demoUser,
  InMemoryDatabase,
  InMemoryTaskRepository,
  InMemoryUnitOfWork,
  InMemoryUserRepository,
} from '../testing/in-memory-repositories';
import { ChangeTaskStatusUseCase } from './change-task-status';
import { CloseTaskUseCase } from './close-task';
import { CreateTaskUseCase } from './create-task';
import { GetTaskUseCase } from './get-task';
import { GetUserTasksUseCase } from './get-user-tasks';
import { ListTaskTypesUseCase } from './list-task-types';
import { ListUsersUseCase } from './list-users';

const ALICE = 'user-alice';
const BOB = 'user-bob';
const QUOTES = { quotes: ['Supplier A - 100', 'Supplier B - 90'] };
const RECEIPT = { receipt: 'INV-2026-001' };

const registry = new TaskTypeRegistry(TASK_TYPE_DEFINITIONS);

let db: InMemoryDatabase;
let create: CreateTaskUseCase;
let changeStatus: ChangeTaskStatusUseCase;
let close: CloseTaskUseCase;
let getTask: GetTaskUseCase;
let getUserTasks: GetUserTasksUseCase;
let listUsers: ListUsersUseCase;

beforeEach(() => {
  db = new InMemoryDatabase().withUsers(demoUser(ALICE, 'Ada'), demoUser(BOB, 'Grace'));

  const unitOfWork = new InMemoryUnitOfWork(db);
  const tasks = new InMemoryTaskRepository(db);
  const users = new InMemoryUserRepository(db);

  create = new CreateTaskUseCase(registry, unitOfWork);
  changeStatus = new ChangeTaskStatusUseCase(registry, unitOfWork);
  close = new CloseTaskUseCase(registry, unitOfWork);
  getTask = new GetTaskUseCase(tasks);
  getUserTasks = new GetUserTasksUseCase(tasks, users);
  listUsers = new ListUsersUseCase(users);
});

describe('GetTaskUseCase', () => {
  it('returns the task with its history in order', async () => {
    const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE, actorUserId: ALICE });
    await changeStatus.execute({
      taskId: created.id,
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });

    const found = await getTask.execute(created.id);

    expect(found.task).toMatchObject({ status: 2, assignedUserId: BOB });
    expect(found.transitions.map((entry) => entry.kind)).toEqual(['CREATE', 'FORWARD']);
  });

  it('reports an unknown task as NOT_FOUND', async () => {
    await expect(getTask.execute('task-ghost')).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});

describe('GetUserTasksUseCase (ADR-012)', () => {
  async function seedOneOpenAndOneClosedForAlice() {
    const open = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE, actorUserId: ALICE });

    const toClose = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE, actorUserId: ALICE });
    let task = await changeStatus.execute({
      taskId: toClose.id,
      toStatus: 2,
      assignedUserId: ALICE,
      actorUserId: ALICE,
      data: QUOTES,
    });
    task = await changeStatus.execute({
      taskId: task.id,
      toStatus: 3,
      assignedUserId: ALICE,
      actorUserId: ALICE,
      data: RECEIPT,
    });
    await close.execute({ taskId: task.id, actorUserId: ALICE });

    return { openId: open.id, closedId: toClose.id };
  }

  it('returns open and closed tasks by default', async () => {
    const { openId, closedId } = await seedOneOpenAndOneClosedForAlice();

    const found = await getUserTasks.execute({ userId: ALICE });

    expect(found.map((task) => task.id).sort()).toEqual([openId, closedId].sort());
  });

  it('narrows to a single state on request', async () => {
    const { openId, closedId } = await seedOneOpenAndOneClosedForAlice();

    expect((await getUserTasks.execute({ userId: ALICE, state: 'OPEN' })).map((t) => t.id)).toEqual(
      [openId],
    );
    expect(
      (await getUserTasks.execute({ userId: ALICE, state: 'CLOSED' })).map((t) => t.id),
    ).toEqual([closedId]);
  });

  it('follows the task when it is handed to somebody else', async () => {
    const created = await create.execute({ type: 'PROCUREMENT', assignedUserId: ALICE, actorUserId: ALICE });
    await changeStatus.execute({
      taskId: created.id,
      toStatus: 2,
      assignedUserId: BOB,
      actorUserId: ALICE,
      data: QUOTES,
    });

    expect(await getUserTasks.execute({ userId: ALICE })).toHaveLength(0);
    expect(await getUserTasks.execute({ userId: BOB })).toHaveLength(1);
  });

  it('distinguishes "no such user" from "no tasks"', async () => {
    await expect(getUserTasks.execute({ userId: 'user-ghost' })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );

    expect(await getUserTasks.execute({ userId: BOB })).toEqual([]);
  });
});

describe('ListTaskTypesUseCase', () => {
  it('describes every registered type for the client, with no database at all', () => {
    const described = new ListTaskTypesUseCase(registry).execute();

    // Whatever is registered is described - the shipped types are asserted by name in
    // task-types.test.ts, which is where the catalogue belongs.
    expect(described).toHaveLength(TASK_TYPE_DEFINITIONS.length);
    expect(described.map((type) => type.type)).toEqual(
      TASK_TYPE_DEFINITIONS.map((definition) => definition.type),
    );

    for (const type of described) {
      expect(type.statuses.length).toBeGreaterThan(0);
      expect(type.statuses[0]?.fields).toEqual([]);
    }
  });

  it('grows by itself when a type is registered - no change to this use case', () => {
    const extended = new TaskTypeRegistry([
      ...TASK_TYPE_DEFINITIONS,
      {
        type: 'THROWAWAY',
        label: 'Throwaway',
        statuses: [
          { name: 'Created', fields: [] },
          {
            name: 'Done',
            fields: [{ kind: 'boolean', name: 'signedOff', label: 'Signed off', required: true }],
          },
        ],
      },
    ]);

    const described = new ListTaskTypesUseCase(extended).execute();

    expect(described.map((type) => type.type)).toContain('THROWAWAY');
  });
});

describe('ListUsersUseCase', () => {
  it('lists the seeded users by name', async () => {
    expect((await listUsers.execute()).map((user) => user.name)).toEqual(['Ada', 'Grace']);
  });
});
