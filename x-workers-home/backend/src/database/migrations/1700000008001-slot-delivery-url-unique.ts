import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 交付链接全局唯一：同一推文不允许交付到多个名额（T14 防重复放款）。
 * 追加迁移而非修改 1700000008000（该迁移可能已在环境应用）。
 * deliver 写入前会把 x/twitter 链接规范化（https / 小写 / 去尾斜杠与查询串 /
 * twitter.com → x.com），因此变体链接也落同一字符串。
 */
export class SlotDeliveryUrlUnique1700000008001 implements MigrationInterface {
  name = 'SlotDeliveryUrlUnique1700000008001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_order_slots_delivery_url"
        ON "order_slots" ("delivery_url")
        WHERE "delivery_url" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_order_slots_delivery_url"`);
  }
}
