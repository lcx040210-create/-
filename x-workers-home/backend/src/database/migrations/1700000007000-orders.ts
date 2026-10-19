import { MigrationInterface, QueryRunner } from 'typeorm';

export class Orders1700000007000 implements MigrationInterface {
  name = 'Orders1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchant_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type" varchar(16) NOT NULL,
        "title" varchar(120) NOT NULL,
        "brief" text NOT NULL,
        "requirements" jsonb NOT NULL DEFAULT '{"keywords":[],"hashtags":[],"mentions":[],"links":[]}'::jsonb,
        "target_tweet_url" text,
        "price_micro" bigint NOT NULL,
        "slots_total" int NOT NULL,
        "fee_micro" bigint NOT NULL DEFAULT 0,
        "fee_earned" boolean NOT NULL DEFAULT false,
        "escrow_micro" bigint NOT NULL DEFAULT 0,
        "status" varchar(16) NOT NULL DEFAULT 'recruiting',
        "expires_at" timestamptz NOT NULL,
        "min_rating_grade" varchar(2),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz,
        CONSTRAINT "chk_orders_price_positive" CHECK ("price_micro" > 0),
        CONSTRAINT "chk_orders_slots_positive" CHECK ("slots_total" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_orders_status_created"
        ON "orders" ("status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_orders_merchant"
        ON "orders" ("merchant_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_orders_merchant"`);
    await queryRunner.query(`DROP INDEX "idx_orders_status_created"`);
    await queryRunner.query(`DROP TABLE "orders"`);
  }
}
