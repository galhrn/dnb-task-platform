import { beforeEach, describe, expect, it } from 'vitest';

import { procurementTaskType } from '../../domain/task-types/procurement.task-type';
import { TaskNotFoundError, VersionConflictError } from '../../domain/workflow/errors';
import { changeTaskStatus, closeTask, createTask } from '../../domain/workflow/workflow-engine';
import type { TaskRepository } from '../ports/task-repository';

/**
 * The answer to "how do you know your fake does not lie?".
 *
 * One suite, run twice: against the in-memory doubles in the unit run, and against
 * Postgres in the integration run. If the fake ever drifts from the real repository on
 * anything a use case depends on, the unit suite and the integration suite stop agreeing
 * and one of them goes red.
 *
 * It asserts behaviour, never storage: no id formats, no timestamps, nothing that is
 * legitimately different between a Map and a table.
 */

export interface TaskRepositoryFixture {
  readonly repository: TaskRepository;
  /**
   * Deletes a task behind the repository's back. Only a test needs this - it is how the
   * suite simulates a row disappearing between a read and a write, which the port has to
   * report as NOT_FOUND rather than as a version conflict.
   */
  remove(taskId: string): Promise<void>;
}

export interface TaskRepositoryHarness {
  readonly alice: string;
  readonly bob: string;
  /** Returns a fixture over empty task storage. Users already exist. */
  setup(): Promise<TaskRepositoryFixture>;
}

const QUOTES = { quotes: ['Supplier A - 100', 'Supplier B - 90'] };
const RECEIPT = { receipt: 'INV-2026-001' };

export function runTaskRepositoryContract(name: string, harness: TaskRepositoryHarness): void {
  describe(`${name} satisfies the TaskRepository contract`, () => {
    let fixture: TaskRepositoryFixture;
    let repository: TaskRepository;

    beforeEach(async () => {
      fixture = await harness.setup();
      repository = fixture.repository;
    });

    async function createdTask() {
      const { task, transition } = createTask(procurementTaskType, {
        assignedUserId: harness.alice,
      });

      return repository.create(task, transition);
    }

    async function advance(
      task: Awaited<ReturnType<typeof createdTask>>,
      toStatus: number,
      data: Record<string, unknown>,
    ) {
      const moved = changeTaskStatus(procurementTaskType, task, {
        toStatus,
        assignedUserId: harness.alice,
        data,
      });

      return repository.applyTransition(moved.task, moved.transition);
    }

    it('creates an open task at version 1 with a CREATE history row', async () => {
      const created = await createdTask();

      expect(created).toMatchObject({
        type: 'PROCUREMENT',
        status: 1,
        state: 'OPEN',
        assignedUserId: harness.alice,
        data: {},
        version: 1,
      });

      const found = await repository.findByIdWithHistory(created.id);

      expect(found?.transitions).toHaveLength(1);
      expect(found?.transitions[0]).toMatchObject({ kind: 'CREATE', fromStatus: null, toStatus: 1 });
    });

    it('returns null for an id it has never seen', async () => {
      expect(await repository.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(
        await repository.findByIdWithHistory('00000000-0000-4000-8000-000000000000'),
      ).toBeNull();
    });

    it('bumps the version on every write and round-trips data keyed by status', async () => {
      const created = await createdTask();
      const moved = await advance(created, 2, QUOTES);

      expect(moved.version).toBe(created.version + 1);
      expect(moved.data).toEqual({ '2': QUOTES });
      expect((await repository.findById(created.id))?.data).toEqual({ '2': QUOTES });
    });

    it('refuses a write built on a version that has already moved', async () => {
      const created = await createdTask();
      const stale = changeTaskStatus(procurementTaskType, created, {
        toStatus: 2,
        assignedUserId: harness.bob,
        data: QUOTES,
      });

      await advance(created, 2, QUOTES);

      await expect(
        repository.applyTransition(stale.task, stale.transition),
      ).rejects.toBeInstanceOf(VersionConflictError);
    });

    it('reports a vanished task as NOT_FOUND rather than a conflict', async () => {
      const created = await createdTask();
      const move = changeTaskStatus(procurementTaskType, created, {
        toStatus: 2,
        assignedUserId: harness.bob,
        data: QUOTES,
      });

      await fixture.remove(created.id);

      await expect(repository.applyTransition(move.task, move.transition)).rejects.toBeInstanceOf(
        TaskNotFoundError,
      );
    });

    it('appends history and never rewrites it, even when the projection is cleared', async () => {
      const created = await createdTask();
      const atTwo = await advance(created, 2, QUOTES);
      const atThree = await advance(atTwo, 3, RECEIPT);

      const back = changeTaskStatus(procurementTaskType, atThree, {
        toStatus: 1,
        assignedUserId: harness.alice,
      });
      const atOne = await repository.applyTransition(back.task, back.transition);

      expect(atOne.data).toEqual({});

      const found = await repository.findByIdWithHistory(created.id);

      expect(found?.transitions.map((entry) => entry.kind)).toEqual([
        'CREATE',
        'FORWARD',
        'FORWARD',
        'BACKWARD',
      ]);
      expect(found?.transitions[1]?.payload).toEqual(QUOTES);
      expect(found?.transitions[2]?.payload).toEqual(RECEIPT);
    });

    it('records the holder on CLOSE and stops reporting the task as open', async () => {
      const created = await createdTask();
      const atThree = await advance(await advance(created, 2, QUOTES), 3, RECEIPT);
      const closed = closeTask(procurementTaskType, atThree);

      const saved = await repository.applyTransition(closed.task, closed.transition);

      expect(saved.state).toBe('CLOSED');
      expect(saved.assignedUserId).toBe(harness.alice);

      expect(await repository.findByAssignee(harness.alice, 'OPEN')).toHaveLength(0);
      expect(await repository.findByAssignee(harness.alice, 'CLOSED')).toHaveLength(1);
      expect(await repository.findByAssignee(harness.alice)).toHaveLength(1);
    });

    it('only returns tasks the user actually holds', async () => {
      const created = await createdTask();

      expect(await repository.findByAssignee(harness.bob)).toHaveLength(0);

      const handedOver = changeTaskStatus(procurementTaskType, created, {
        toStatus: 2,
        assignedUserId: harness.bob,
        data: QUOTES,
      });
      await repository.applyTransition(handedOver.task, handedOver.transition);

      expect(await repository.findByAssignee(harness.alice)).toHaveLength(0);
      expect(await repository.findByAssignee(harness.bob)).toHaveLength(1);
    });
  });
}
