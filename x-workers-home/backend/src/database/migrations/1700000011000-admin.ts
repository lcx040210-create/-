import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T17 管理后台：
 * - admin_actions：所有 admin 写操作审计（登录除外）。
 * - admin_user_id 允许为空：管理员账号被删除时保留审计记录（SET NULL）。
 */
export class Admin1700000011000 implements MigrationInterface {
  name = 'Admin1700000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_actions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admin_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "action" varchar(64) NOT NULL,
        "target_type" varchar(32) NOT NULL,
        "target_id" varchar(64) NOT NULL,
        "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_admin_actions_admin_created"
        ON "admin_actions" ("admin_user_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_admin_actions_target"
        ON "admin_actions" ("target_type", "target_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_admin_actions_target"`);
    await queryRunner.query(`DROP INDEX "idx_admin_actions_admin_created"`);
    await queryRunner.query(`DROP TABLE "admin_actions"`);
  }
}
