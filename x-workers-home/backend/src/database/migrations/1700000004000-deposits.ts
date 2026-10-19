import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 充值：链上转入留档（deposits）+ BSC 监听游标（chain_cursors）。
 * deposits 以 (tx_hash, log_index) 唯一，监听器重放时天然幂等。
 */
export class Deposits1700000004000 implements MigrationInterface {
  name = 'Deposits1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "deposits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tx_hash" varchar(66) NOT NULL,
        "log_index" int NOT NULL,
        "from_address" varchar(42) NOT NULL,
        "to_address" varchar(42) NOT NULL,
        "raw_amount_wei" varchar(78) NOT NULL,
        "amount_micro" bigint NOT NULL,
        "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "status" varchar(16) NOT NULL,
        "block_number" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_deposits_tx_log" UNIQUE ("tx_hash", "log_index"),
        CONSTRAINT "chk_deposits_status" CHECK ("status" IN ('credited', 'unmatched')),
        CONSTRAINT "chk_deposits_amount_non_negative" CHECK ("amount_micro" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_deposits_user_block"
        ON "deposits" ("user_id", "block_number" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_deposits_status_created"
        ON "deposits" ("status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "chain_cursors" (
        "id" varchar(16) PRIMARY KEY,
        "last_block" bigint NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(
      `INSERT INTO "chain_cursors" ("id", "last_block") VALUES ('bsc', 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chain_cursors"`);
    await queryRunner.query(`DROP TABLE "deposits"`);
  }
}
