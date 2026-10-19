import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T15 fix：同一 slot 的删帖争议只允许一次（不论 open / resolved_*）。
 *
 * 背景：先前仅约束「同一时刻一个 open 争议」，首次删帖争议以 resolved_clawback
 * 结案后，商家可在剩余 7 天窗口内再次举报并重复追回，破坏「追回至多 P」。
 *
 * 迁移前数据修复：删帖争议尚未上线，重复行为 bug 产物；按 slot 仅保留最早一条
 *（幂等保留既有审计记录，避免唯一索引创建失败）。
 */
export class DeletionDisputeOnce1700000009001 implements MigrationInterface {
  name = 'DeletionDisputeOnce1700000009001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "disputes" d
       USING "disputes" keep
       WHERE d."kind" = 'deletion'
         AND keep."kind" = 'deletion'
         AND d."slot_id" = keep."slot_id"
         AND (keep."created_at" < d."created_at"
              OR (keep."created_at" = d."created_at" AND keep."id" < d."id"))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_disputes_deletion_once"
        ON "disputes" ("slot_id")
        WHERE "kind" = 'deletion'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_disputes_deletion_once"`);
  }
}
