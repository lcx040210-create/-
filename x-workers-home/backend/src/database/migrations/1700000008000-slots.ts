import { MigrationInterface, QueryRunner } from 'typeorm';

export class Slots1700000008000 implements MigrationInterface {
  name = 'Slots1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "order_slots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "creator_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "status" varchar(16) NOT NULL DEFAULT 'reserved',
        "accepted_at" timestamptz NOT NULL,
        "deliver_deadline_at" timestamptz NOT NULL,
        "delivered_at" timestamptz,
        "delivery_url" text,
        "last_reject" jsonb,
        "verify_snapshot" jsonb,
        "manual_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "appeal_requested" boolean NOT NULL DEFAULT false,
        "confirmed_deadline_at" timestamptz,
        "settled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_order_slots_order_status"
        ON "order_slots" ("order_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_order_slots_creator_status"
        ON "order_slots" ("creator_user_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_order_slots_due"
        ON "order_slots" ("status", "deliver_deadline_at")
    `);
    // 一个用户在一张商单里只能占一个活跃名额（expired / refunded 不占）
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_order_slots_active_creator"
        ON "order_slots" ("order_id", "creator_user_id")
        WHERE "status" NOT IN ('expired', 'refunded')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_order_slots_active_creator"`);
    await queryRunner.query(`DROP INDEX "idx_order_slots_due"`);
    await queryRunner.query(`DROP INDEX "idx_order_slots_creator_status"`);
    await queryRunner.query(`DROP INDEX "idx_order_slots_order_status"`);
    await queryRunner.query(`DROP TABLE "order_slots"`);
  }
}
