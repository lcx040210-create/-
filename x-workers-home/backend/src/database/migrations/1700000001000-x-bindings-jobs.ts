import { MigrationInterface, QueryRunner } from 'typeorm';

export class XBindingsJobs1700000001000 implements MigrationInterface {
  name = 'XBindingsJobs1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 通用任务轮询器（T5 基座；T12/T13 复用 delivery 类型）
    await queryRunner.query(`
      CREATE TABLE "verification_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "type" varchar(32) NOT NULL,
        "ref_id" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "attempts" int NOT NULL DEFAULT 0,
        "next_run_at" timestamptz NOT NULL DEFAULT now(),
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_verification_jobs_due"
        ON "verification_jobs" ("status", "next_run_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_verification_jobs_ref"
        ON "verification_jobs" ("type", "ref_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "x_bindings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
        "handle" varchar(16) NOT NULL UNIQUE,
        "code" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "binding_changes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "kind" varchar(8) NOT NULL,
        "new_value" varchar(64) NOT NULL,
        "status" varchar(12) NOT NULL DEFAULT 'pending',
        "effective_at" timestamptz NOT NULL,
        "applied_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_binding_changes_user_kind"
        ON "binding_changes" ("user_id", "kind", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_binding_changes_due"
        ON "binding_changes" ("status", "effective_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "kind" varchar(32) NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" text NOT NULL,
        "ref_type" varchar(32),
        "ref_id" varchar(64),
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_notifications_user_created"
        ON "notifications" ("user_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TABLE "binding_changes"`);
    await queryRunner.query(`DROP TABLE "x_bindings"`);
    await queryRunner.query(`DROP TABLE "verification_jobs"`);
  }
}
