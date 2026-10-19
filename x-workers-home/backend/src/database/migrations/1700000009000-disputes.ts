import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T15 争议：
 * - order_slots.survival_override：人工裁决放行（争议 payout / 人工核验 pass）后，
 *   payout job 跳过存活复检，避免「人工放行被已删推文弹回」。
 * - disputes：商家申诉（质量 / 删帖）与人工裁决记录。
 */
export class Disputes1700000009000 implements MigrationInterface {
  name = 'Disputes1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_slots"
        ADD COLUMN "survival_override" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE TABLE "disputes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "slot_id" uuid NOT NULL REFERENCES "order_slots"("id") ON DELETE CASCADE,
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "raised_by" varchar(16) NOT NULL,
        "kind" varchar(16) NOT NULL,
        "statement" text NOT NULL,
        "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar(24) NOT NULL DEFAULT 'open',
        "ruling" text,
        "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "resolved_at" timestamptz,
        "arbiter_meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_disputes_slot" ON "disputes" ("slot_id")`);
    await queryRunner.query(`CREATE INDEX "idx_disputes_status" ON "disputes" ("status")`);
    // 同一名额同一时刻至多一个未结案争议（防重复申诉 / 重复举报）。
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_disputes_open_slot"
        ON "disputes" ("slot_id")
        WHERE "status" = 'open'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_disputes_open_slot"`);
    await queryRunner.query(`DROP INDEX "idx_disputes_status"`);
    await queryRunner.query(`DROP INDEX "idx_disputes_slot"`);
    await queryRunner.query(`DROP TABLE "disputes"`);
    await queryRunner.query(`
      ALTER TABLE "order_slots" DROP COLUMN "survival_override"
    `);
  }
}
