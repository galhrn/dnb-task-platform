import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hand-written SQL rather than generated, and committed (section 10). `synchronize` is
 * off permanently, so this file is the only thing that has ever shaped the database.
 *
 * The CHECK constraints encode structure, not policy: `state` and `kind` are closed sets
 * that belong to the workflow itself, so the database can hold the line even if a future
 * caller finds a way around the Zod boundary. Nothing task-type-specific is encoded here -
 * that would need a migration per type and defeat ADR-007.
 *
 * `text` with a CHECK rather than a Postgres enum: adding a value to an enum is an ALTER
 * TYPE that cannot run inside every transaction, and this buys nothing over a constraint.
 */
export class InitialSchema1755730000000 implements MigrationInterface {
  name = 'InitialSchema1755730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built into Postgres 13+, so no extension is required.
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"       text        NOT NULL,
        "email"      text        NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "type"             text        NOT NULL,
        "status"           int         NOT NULL,
        "state"            text        NOT NULL,
        "assigned_user_id" uuid        NOT NULL,
        "data"             jsonb       NOT NULL DEFAULT '{}'::jsonb,
        "version"          int         NOT NULL DEFAULT 1,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_tasks_assigned_user" FOREIGN KEY ("assigned_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_tasks_status_positive" CHECK ("status" >= 1),
        CONSTRAINT "ck_tasks_state" CHECK ("state" IN ('OPEN', 'CLOSED'))
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_tasks_assigned_user_id" ON "tasks" ("assigned_user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_tasks_type" ON "tasks" ("type")`);

    await queryRunner.query(`
      CREATE TABLE "task_transitions" (
        "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "task_id"          uuid        NOT NULL,
        "from_status"      int         NULL,
        "to_status"        int         NULL,
        "kind"             text        NOT NULL,
        "payload"          jsonb       NOT NULL DEFAULT '{}'::jsonb,
        "assigned_user_id" uuid        NOT NULL,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_task_transitions_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_task_transitions_assigned_user" FOREIGN KEY ("assigned_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_task_transitions_kind"
          CHECK ("kind" IN ('CREATE', 'FORWARD', 'BACKWARD', 'CLOSE')),
        CONSTRAINT "ck_task_transitions_endpoints"
          CHECK ("from_status" IS NOT NULL OR "to_status" IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_task_transitions_task_id_created_at"
        ON "task_transitions" ("task_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "task_transitions"`);
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
