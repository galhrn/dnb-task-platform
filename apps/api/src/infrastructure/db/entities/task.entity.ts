import type { TaskState } from '@task-platform/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * One table for every task type (ADR-007). Column names are written out rather than
 * derived by a naming strategy: the migration is hand-written, so the two have to agree
 * literally, and a reader can check them side by side.
 *
 * There is no @ManyToOne to UserEntity. The foreign keys are real - declared in the
 * migration - but nothing in the API traverses the association, and an ORM relation that
 * exists only to look thorough invites accidental eager loading.
 */
@Entity({ name: 'tasks' })
@Index('idx_tasks_assigned_user_id', ['assignedUserId'])
@Index('idx_tasks_type', ['type'])
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Registry key. Not a foreign key: task types live in code, not in a table. */
  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'int' })
  status!: number;

  @Column({ type: 'text' })
  state!: TaskState;

  @Column({ name: 'assigned_user_id', type: 'uuid' })
  assignedUserId!: string;

  /** The read projection, keyed by status (ADR-007). Source of truth is task_transitions. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data!: Record<string, Record<string, unknown>>;

  /** ADR-010 - TypeORM bumps this on every save and guards the UPDATE with its old value. */
  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
