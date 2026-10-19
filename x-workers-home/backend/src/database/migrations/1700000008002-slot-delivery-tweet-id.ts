import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 推文级交付去重（T13 fix）：同一推文可用 `/<handle>/status/<id>` 或
 * `/i/web/status/<id>` 两种字符串形式交付，原始 URL 唯一索引拦不住，
 * 会导致同一推文占两个名额并重复放款。这里抽取推文 id 并建部分唯一索引。
 * 原有 delivery_url 唯一索引入保留（双保险）。
 */
export class SlotDeliveryTweetId1700000008002 implements MigrationInterface {
  name = 'SlotDeliveryTweetId1700000008002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_slots" ADD COLUMN "delivery_tweet_id" varchar(32)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_order_slots_delivery_tweet_id"
        ON "order_slots" ("delivery_tweet_id")
        WHERE "delivery_tweet_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_order_slots_delivery_tweet_id"`);
    await queryRunner.query(`ALTER TABLE "order_slots" DROP COLUMN "delivery_tweet_id"`);
  }
}
