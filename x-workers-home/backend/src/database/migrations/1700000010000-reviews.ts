import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T16 双向互评：
 * - reviews：每个 paid 名额上，交易双方各一条评价（唯一索引兜底「每侧一次」）。
 * - to_user_id 索引服务公开主页的星级聚合与近期评价。
 */
export class Reviews1700000010000 implements MigrationInterface {
  name = 'Reviews1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "slot_id" uuid NOT NULL REFERENCES "order_slots"("id") ON DELETE CASCADE,
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "from_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "to_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "score" int NOT NULL CHECK ("score" BETWEEN 1 AND 5),
        "comment" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_reviews_slot_from"
        ON "reviews" ("slot_id", "from_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_reviews_to_user"
        ON "reviews" ("to_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_reviews_to_user"`);
    await queryRunner.query(`DROP INDEX "uq_reviews_slot_from"`);
    await queryRunner.query(`DROP TABLE "reviews"`);
  }
}
