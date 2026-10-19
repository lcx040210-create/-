import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 提现：一笔申请一行（规则校验 + 立即冻结 + 人工审核流状态机）。
 * fee/payout 在申请时固定，供审核队列与对账使用。
 */
export class Withdrawals1700000005000 implements MigrationInterface {
  name = 'Withdrawals1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "withdrawals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "address" varchar(42) NOT NULL,
        "amount_micro" bigint NOT NULL,
        "fee_micro" bigint NOT NULL,
        "payout_micro" bigint NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "reject_reason" text,
        "tx_hash" varchar(66),
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_withdrawals_status"
          CHECK ("status" IN ('pending', 'approved', 'paid', 'rejected')),
        CONSTRAINT "chk_withdrawals_amount_positive" CHECK ("amount_micro" > 0),
        CONSTRAINT "chk_withdrawals_fee_range"
          CHECK ("fee_micro" >= 0 AND "fee_micro" <= "amount_micro"),
        CONSTRAINT "chk_withdrawals_payout"
          CHECK ("payout_micro" >= 0 AND "payout_micro" = "amount_micro" - "fee_micro")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_withdrawals_user_created"
        ON "withdrawals" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_withdrawals_status"
        ON "withdrawals" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "withdrawals"`);
  }
}
