import * as dotenv from 'dotenv';
import * as path from 'path';

// e2e 测试一律使用 .env.test（DB_DATABASE=xwh_test），且必须在
// database.config / AppModule 被 import 之前加载。
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
