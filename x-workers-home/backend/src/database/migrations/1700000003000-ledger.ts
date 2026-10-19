import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 平台账户固定 UUID（迁移预置，owner_user_id = null）。
 * 后续任务（充值/发单/放款/对账）直接引用，不要另建平台账户。
 */
export const PLATFORM_ACCOUNTS = {
  escrow: '00000000-0000-4000-8000-000000000001',
  income: '00000000-0000-4000-8000-000000000002',
} as const;

export class Ledger1700000003000 implements MigrationInterface {
  name = 'Ledger1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" uuid UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
        "kind" varchar(16) NOT NULL,
        "available" bigint NOT NULL DEFAULT 0,
        "frozen" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "chk_accounts_available_non_negative" CHECK ("available" >= 0),
        CONSTRAINT "chk_accounts_frozen_non_negative" CHECK ("frozen" >= 0)
      )
    `);

    await queryRunner.query(
      `INSERT INTO "accounts" ("id", "owner_user_id", "kind")
       VALUES ($1, NULL, 'escrow'), ($2, NULL, 'platform_income')`,
      [PLATFORM_ACCOUNTS.escrow, PLATFORM_ACCOUNTS.income],
    );

    await queryRunner.query(`
      CREATE TABLE "ledger_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
        "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "kind" varchar(32) NOT NULL,
        "ref_type" varchar(16) NOT NULL,
        "ref_id" uuid NOT NULL,
        "available_delta" bigint NOT NULL,
        "frozen_delta" bigint NOT NULL,
        "available_after" bigint NOT NULL,
        "frozen_after" bigint NOT NULL,
        "memo" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ledger_entries_account_created"
        ON "ledger_entries" ("account_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ledger_entries_user_created"
        ON "ledger_entries" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ledger_entries_ref"
        ON "ledger_entries" ("ref_type", "ref_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ledger_entries"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
  }
}
