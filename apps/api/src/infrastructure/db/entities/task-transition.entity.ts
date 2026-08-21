import type { TransitionKind } from '@task-platform/contracts';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only. Nothing in the codebase updates or deletes a row here, which is what makes
 * clear-forward (WF-7b) safe: wiping the projection destroys no history.
 */
@Entity({ name: 'task_transitions' })
@Index('idx_task_transitions_task_id_created_at', ['taskId', 'createdAt'])
export class TaskTransitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  /** null on the CREATE record. */
  @Column({ name: 'from_status', type: 'int', nullable: true })
  fromStatus!: number | null;

  /** null on the CLOSE record. */
  @Column({ name: 'to_status', type: 'int', nullable: true })
  toStatus!: number | null;

  @Column({ type: 'text' })
  kind!: TransitionKind;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  /** Who held the task after this transition - including on CLOSE (ADR-011). */
  @Column({ name: 'assigned_user_id', type: 'uuid' })
  assignedUserId!: string;

  /** Who performed it. Self-asserted by the caller; there is no authentication here. */
  @Column({ name: 'actor_user_id', type: 'uuid' })
  @Index('idx_task_transitions_actor_user_id')
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
