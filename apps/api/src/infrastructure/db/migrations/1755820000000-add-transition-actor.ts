import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `task_transitions` recorded who the task was handed TO, but not who did the handing.
 * Those are different people whenever work changes hands, and a close has an actor and no
 * new holder at all - so the log could not answer "who closed this?".
 *
 * Existing rows are backfilled from `assigned_user_id`. That is a best-effort guess for
 * history recorded before the column existed, and it is wrong exactly when the task
 * changed hands - which is why it happens once, here, rather than being computed at read
 * time and presented as fact.
 */
export class AddTransitionActor1755820000000 implements MigrationInterface {
  name = 'AddTransitionActor1755820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "task_transitions" ADD COLUMN "actor_user_id" uuid`);

    await queryRunner.query(`
      UPDATE "task_transitions"
         SET "actor_user_id" = "assigned_user_id"
       WHERE "actor_user_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "task_transitions" ALTER COLUMN "actor_user_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "task_transitions"
        ADD CONSTRAINT "fk_task_transitions_actor"
        FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT
    `);

    // "What has this person done?" is the question an audit log gets asked.
    await queryRunner.query(`
      CREATE INDEX "idx_task_transitions_actor_user_id"
        ON "task_transitions" ("actor_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_task_transitions_actor_user_id"`);
    await queryRunner.query(
      `ALTER TABLE "task_transitions" DROP CONSTRAINT "fk_task_transitions_actor"`,
    );
    await queryRunner.query(`ALTER TABLE "task_transitions" DROP COLUMN "actor_user_id"`);
  }
}
