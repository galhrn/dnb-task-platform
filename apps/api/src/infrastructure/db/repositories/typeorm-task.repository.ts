import type { TaskState } from '@task-platform/contracts';
import type { EntityManager } from 'typeorm';

import type {
  PersistedTask,
  PersistedTransition,
  TaskRepository,
  TaskWithHistory,
} from '../../../application/ports/task-repository';
import type { NewTaskSnapshot, TaskSnapshot } from '../../../domain/task';
import { TaskNotFoundError, VersionConflictError } from '../../../domain/workflow/errors';
import type { TransitionRecord } from '../../../domain/workflow/workflow-engine';
import { TaskEntity } from '../entities/task.entity';
import { TaskTransitionEntity } from '../entities/task-transition.entity';

function toPersistedTask(entity: TaskEntity): PersistedTask {
  return {
    id: entity.id,
    type: entity.type,
    status: entity.status,
    state: entity.state,
    assignedUserId: entity.assignedUserId,
    data: entity.data,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

/** The shape `RETURNING *` hands back: real column names, straight from the driver. */
interface TaskRow {
  id: string;
  type: string;
  status: number;
  state: TaskState;
  assigned_user_id: string;
  data: Record<string, Record<string, unknown>>;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
}

function rowToPersistedTask(row: TaskRow): PersistedTask {
  return {
    id: row.id,
    type: row.type,
    status: Number(row.status),
    state: row.state,
    assignedUserId: row.assigned_user_id,
    data: row.data,
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toPersistedTransition(entity: TaskTransitionEntity): PersistedTransition {
  return {
    id: entity.id,
    fromStatus: entity.fromStatus,
    toStatus: entity.toStatus,
    kind: entity.kind,
    payload: entity.payload,
    assignedUserId: entity.assignedUserId,
    actorUserId: entity.actorUserId,
    createdAt: entity.createdAt,
  };
}

/**
 * The TypeORM implementation of the TaskRepository port.
 *
 * It takes an EntityManager rather than reaching for a global one, so the very same class
 * serves a plain read and a transactional write - the UnitOfWork simply constructs it with
 * the transaction's manager. That is the whole reason the application layer can own
 * transaction boundaries without knowing what a transaction is.
 */
export class TypeOrmTaskRepository implements TaskRepository {
  constructor(private readonly manager: EntityManager) {}

  async create(task: NewTaskSnapshot, transition: TransitionRecord): Promise<PersistedTask> {
    const saved = await this.manager.save(
      this.manager.create(TaskEntity, {
        type: task.type,
        status: task.status,
        state: task.state,
        assignedUserId: task.assignedUserId,
        data: { ...task.data },
      }),
    );

    await this.appendTransition(saved.id, transition);

    return toPersistedTask(saved);
  }

  async findById(id: string): Promise<PersistedTask | null> {
    const entity = await this.manager.findOne(TaskEntity, { where: { id } });

    return entity === null ? null : toPersistedTask(entity);
  }

  async findByIdWithHistory(id: string): Promise<TaskWithHistory | null> {
    const entity = await this.manager.findOne(TaskEntity, { where: { id } });

    if (entity === null) {
      return null;
    }

    const transitions = await this.manager.find(TaskTransitionEntity, {
      where: { taskId: id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return {
      task: toPersistedTask(entity),
      transitions: transitions.map(toPersistedTransition),
    };
  }

  async findByAssignee(assignedUserId: string, state?: TaskState): Promise<PersistedTask[]> {
    const entities = await this.manager.find(TaskEntity, {
      where: state === undefined ? { assignedUserId } : { assignedUserId, state },
      order: { createdAt: 'DESC' },
    });

    return entities.map(toPersistedTask);
  }

  async applyTransition(next: TaskSnapshot, transition: TransitionRecord): Promise<PersistedTask> {
    // A conditional UPDATE, not save(). TypeORM's save() ignores the version it was given
    // and writes anyway - verified in task.repository.int.test.ts, which is why that test
    // exists. The query builder does honour @VersionColumn: it adds `version = version + 1`
    // and, with the guard below, updates nothing when the row has moved on.
    //
    // The version compared against is the one the caller READ, so a lost update is
    // impossible even when the client sent no expectedVersion (ADR-015). RETURNING * gives
    // the committed row back in the same round trip.
    const result = await this.manager
      .createQueryBuilder()
      .update(TaskEntity)
      .set({
        status: next.status,
        state: next.state,
        assignedUserId: next.assignedUserId,
        data: { ...next.data },
      })
      .where('id = :id AND version = :version', { id: next.id, version: next.version })
      .returning('*')
      .execute();

    const row = (result.raw as TaskRow[])[0];

    if (result.affected === 0 || row === undefined) {
      throw await this.explainFailedWrite(next);
    }

    await this.appendTransition(next.id, transition);

    return rowToPersistedTask(row);
  }

  /** Nothing was updated. Either the row is gone, or somebody else got there first. */
  private async explainFailedWrite(next: TaskSnapshot): Promise<Error> {
    const current = await this.manager.findOne(TaskEntity, { where: { id: next.id } });

    return current === null
      ? new TaskNotFoundError(next.id)
      : new VersionConflictError(next.version, current.version);
  }

  private async appendTransition(taskId: string, transition: TransitionRecord): Promise<void> {
    await this.manager.save(
      this.manager.create(TaskTransitionEntity, {
        taskId,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        kind: transition.kind,
        payload: { ...transition.payload },
        assignedUserId: transition.assignedUserId,
        actorUserId: transition.actorUserId,
      }),
    );
  }
}
