import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAuth1700000000000 implements MigrationInterface {
  name = 'InitAuth1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "address" varchar(42) NOT NULL UNIQUE,
        "status" varchar(24) NOT NULL DEFAULT 'pending_x_binding',
        "role" varchar(16) NOT NULL DEFAULT 'user',
        "password_hash" varchar(72),
        "nickname" varchar(64),
        "rating_grade" varchar(2),
        "violations" int NOT NULL DEFAULT 0,
        "suspended_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "auth_nonces" (
        "address" varchar(42) PRIMARY KEY,
        "nonce" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used" boolean NOT NULL DEFAULT false
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "token_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked" boolean NOT NULL DEFAULT false
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "auth_nonces"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
