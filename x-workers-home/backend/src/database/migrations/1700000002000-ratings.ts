import { MigrationInterface, QueryRunner } from 'typeorm';

export class Ratings1700000002000 implements MigrationInterface {
  name = 'Ratings1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_ratings" (
        "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "score" int NOT NULL,
        "grade" varchar(2) NOT NULL,
        "flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "breakdown" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "computed_at" timestamptz NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_ratings"`);
  }
}
