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

// fail fast：充值相关变量必须由 .env.test 提供。setupFiles 阶段尚未加载 .env，
// 因此这里缺失就说明测试环境不自包含（否则 database.config 会静默从 gitignored 的 .env 补值）。
const requiredTestEnvs = [
  'BSC_RPC_URL',
  'PLATFORM_WALLET_ADDRESS',
  'USDT_BEP20_CONTRACT',
  'DEPOSIT_MIN_CONFIRMATIONS',
] as const;
const missingTestEnvs = requiredTestEnvs.filter((key) => !(process.env[key] || '').trim());
if (missingTestEnvs.length) {
  throw new Error(
    `测试环境校验失败：缺少 ${missingTestEnvs.join(', ')}。` +
      `请从 backend/.env.test.example 复制创建 backend/.env.test 后重试` +
      `（充值测试不得依赖 backend/.env）。`,
  );
}
