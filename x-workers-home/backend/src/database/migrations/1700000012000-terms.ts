import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T19 服务条款：
 * - terms：版本化条款，is_current 部分唯一索引保证全表只有一条当前版本；
 * - user_consents：用户同意记录，唯一 (user_id, terms_version) 保证幂等；
 * - 预置 v1 占位正文，运营者后续通过 POST /api/admin/terms 发布终稿。
 */
export class Terms1700000012000 implements MigrationInterface {
  name = 'Terms1700000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "terms" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "version" int NOT NULL UNIQUE,
        "title" varchar(200) NOT NULL,
        "content_md" text NOT NULL,
        "published_at" timestamptz NOT NULL DEFAULT now(),
        "is_current" boolean NOT NULL DEFAULT false
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_terms_single_current"
        ON "terms" ("is_current") WHERE "is_current" = true
    `);
    await queryRunner.query(`
      CREATE TABLE "user_consents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "terms_version" int NOT NULL,
        "agreed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_user_consents_user_version"
        ON "user_consents" ("user_id", "terms_version")
    `);

    await queryRunner.query(`
      INSERT INTO "terms" ("version", "title", "content_md", "published_at", "is_current")
      VALUES (
        1,
        '用户协议与免责声明',
        $md$# 用户协议与免责声明

> 占位版本：本条款正文为运营者预留的占位内容，正式上线前由运营者替换为终稿。

## 服务说明

本平台为内容创作者与商家提供商单撮合、资金托管与争议处理服务。您在注册前应完整阅读并同意本条款；注册即表示您已理解并接受本条款的全部内容。

## 违规定义与处置（含没收不予退还）

以下行为构成违规：虚假交付、刷量作弊、恶意拒付、冒用他人身份、绕过平台私下交易、发布违法或侵权内容等。平台可视情节采取警告、罚则、冻结账户、没收违规所得等措施；因违规被没收的款项不予退还。

## 免责声明

平台仅提供信息撮合与资金托管技术服务，不对用户发布内容的真实性、合法性作出保证。因用户自身行为、第三方行为或不可抗力造成的损失，平台在法律允许的范围内不承担责任。

## 争议处理

发生争议时，双方应先行协商；协商不成的，可向平台提交争议申请，由平台依据平台规则作出处理。对处理结果有异议的，可依法向运营者所在地有管辖权的机构主张权利。
$md$,
        now(),
        true
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_user_consents_user_version"`);
    await queryRunner.query(`DROP TABLE "user_consents"`);
    await queryRunner.query(`DROP INDEX "uq_terms_single_current"`);
    await queryRunner.query(`DROP TABLE "terms"`);
  }
}
