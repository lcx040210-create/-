import * as dotenv from 'dotenv';
import * as path from 'path';

// e2e 测试一律使用 .env.test（DB_DATABASE_TEST=xwh_test），且必须在
// database.config / AppModule 被 import 之前加载。
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

// fail fast：绝不允许测试回退到开发库（.env 的 DB_DATABASE=xwh / 硬编码回退）。
const testDatabase = (process.env.DB_DATABASE_TEST || process.env.DB_DATABASE || '').trim();
if (!testDatabase || !testDatabase.endsWith('_test')) {
  throw new Error(
    `测试环境校验失败：DB_DATABASE_TEST 必须存在且以 "_test" 结尾（当前: "${testDatabase}"）。` +
      `请从 backend/.env.test.example 复制创建 backend/.env.test 后重试。`,
  );
}
process.env.DB_DATABASE = testDatabase;
