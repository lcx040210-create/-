import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomBytes } from 'crypto';

/**
 * 邀请返佣：users.ref_code（每人一个邀请码）+ referrals（一人只能被绑一次）。
 * 存量用户回填 6 位大写字母数字邀请码，排除易混字符 0/1/I/O，碰撞重试。
 */
const REF_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REF_CODE_LENGTH = 6;

function randomRefCode(): string {
  const bytes = randomBytes(REF_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < REF_CODE_LENGTH; i++) {
    code += REF_CODE_ALPHABET[bytes[i] & 31];
  }
  return code;
}

export class Referrals1700000006000 implements MigrationInterface {
  name = 'Referrals1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "ref_code" varchar(8)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_ref_code" ON "users" ("ref_code")`,
    );

    // 存量用户逐个回填；NOT EXISTS + 唯一索引保证不写重
    const existing: Array<{ id: string }> = await queryRunner.query(
      `SELECT "id" FROM "users" WHERE "ref_code" IS NULL`,
    );
    for (const row of existing) {
      let assigned = false;
      for (let attempt = 0; attempt < 20 && !assigned; attempt++) {
        const code = randomRefCode();
        const updated: Array<{ id: string }> = await queryRunner.query(
          `UPDATE "users" SET "ref_code" = $1
            WHERE "id" = $2
              AND NOT EXISTS (SELECT 1 FROM "users" WHERE "ref_code" = $1)
            RETURNING "id"`,
          [code, row.id],
        );
        assigned = updated.length > 0;
      }
      if (!assigned) {
        throw new Error(`邀请码回填失败：用户 ${row.id} 连续碰撞，请重试迁移`);
      }
    }

    await queryRunner.query(`
      CREATE TABLE "referrals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "referrer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "invitee_user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_referrals_no_self" CHECK ("referrer_user_id" <> "invitee_user_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_referrals_referrer"
        ON "referrals" ("referrer_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "referrals"`);
    await queryRunner.query(`DROP INDEX "uq_users_ref_code"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "ref_code"`);
  }
}
