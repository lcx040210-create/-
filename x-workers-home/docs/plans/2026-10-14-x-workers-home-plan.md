# X工作者之家 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 X工作者之家 1.0——X 中文区商单撮合平台（发单/抢单/3h 交付/自动核验/48h 超时自动放款/全人工提现/对账）。

**Architecture:** 单体 NestJS 后端（含定时任务与核验队列）+ Next.js 前端 + PostgreSQL + 单一 BSC 热钱包托管；金额全部以 micro-XM（1e-6）bigint 记账，所有资金变动走账本服务并在数据库事务内完成。

**Tech Stack:** NestJS 10 + TypeORM 0.3 + PostgreSQL 16 + Redis 7（占位，1.0 核心逻辑不依赖）+ Next.js 14 + Tailwind + ethers v6 + Jest/Supertest；核验用 Python 脚本 `tools/x.py`（child_process 调用，无 X API）。

**Spec:** `x-workers-home/docs/specs/2026-10-14-x-workers-home-design.md`（执行前通读；本计划从 spec 推导，spec 与计划同行）

## Global Constraints

以下为 spec 的全局硬性口径，每个任务默认全部适用：

- **费率**：充值 1:1 零手续费；发单费 = 预算 × 5%（建单冻结 = 预算 × 1.05）；完结费 = 单价 × 5%（接单方到手 0.95 × 单价）；提现费 10%（100 XM → 90 USDT）。
- **金额口径**：一切金额为整数 **micro-XM（1e-6 XM）**，DB 存 `bigint`，禁止浮点；API 传入/传出为十进制字符串；费率除法一律 `floor(amount × num / den)`，零头留给用户侧（如手续费=floor，其余给收款方）；链上 USDT（BEP20，18 位小数）解析后向下取整到 micro。
- **时间规则（固定，不按单配置）**：接单后 **3h** 内必须交付，超时释放名额并记违约；交付核验通过后 **48h** 确认窗，超时自动放款；放款前存活复检；放款后 **7 天**内可举报删帖追回。
- **提现规则**：仅能提至绑定钱包；≥50 XM；**整十数**；每用户 **24h 限一笔**（按上一笔申请时间滚动；被驳回可立即重发）；**全人工审核 + 人工打款，任何形式的自动出金都是严重违规**；gas 平台承担。
- **充值规则**：仅 BSC 单链；平台固定收款地址；按链上 from 地址匹配绑定用户自动 1:1 记账（15 确认）；匹配不上进人工队列。
- **商单**：**无人工审核，自动上架**；先到先得抢单、名额不超卖；一个 X / 一个钱包只能绑一个账号；XM 不可互转。
- **账户评级**：粉丝 30% / 均浏览 25% / 互动 25% / 年龄 10% / 关注比 10%（v1 权重，数值见任务 T6）；每周刷新；刷粉特征加重扣分。
- **返佣**：默认 20%、满 5 人 30%、满 10 人 40%（封顶）；基数 = 被邀人产生的**平台手续费**（发单/完结/提现），以 XM 发放，记营销支出。
- **罚则**：admin 抽查认定违规 → 下架单 + **没收全部余额不予退还** + 封号；善意已交付的接单方由平台从没收款按单值补发。
- **永不做**：自动出金、站内聊天/私信、XM 互转。
- **工程约定**：沿用 english-platform 风格——全局前缀 `/api`、`ValidationPipe(whitelist, forbidNonWhitelisted, transform)`、JWT access+refresh、TypeORM `synchronize:false`（迁移手写）；dev 端口 **API 4001 / Web 4000**（避开 english-platform 的 3001/3000）；时间一律 UTC 存取；站内文案中文。
- **开发环境注记**：本机在国内，`tools/x.py` 走 `api.fxtwitter.com` 需要 HTTP 代理（`HTTPS_PROXY=http://127.0.0.1:PORT`，不支持 socks；影子 socks 端口 1080 不可直接用）；生产 VPS 在海外直连无需代理。默认测试用 fixture，不联网；联网冒烟测试单独目录 `test/network/` 且默认排除。

## Review Focus

1. **并发抢单**：两个用户同时抢最后一个名额——必须恰好一人成功、另一人明确失败（T12 并发测试钉住）。
2. **金额精度与分割**：0.95/0.05 分割、90% 提现、18 位链上小数降为 micro——floor 规则下账账相等、无 1 micro 漂移（T7/T9 钉住）。
3. **重复与重放**：重复提交交付、连点提现、同一 tx 重复入账——全部幂等（T8/T9/T12/T13 钉住）。
4. **定时器与人工操作竞态**：48h 自动放款与商家同时确认/发起争议同时发生、3h 超时与同时交付——事务内锁 + 状态复核保证只有一个动作生效（T13/T14 钉住）。
5. **上游抖动**：BSC RPC 超时、爬虫失败/限流——重试 + 降级人工，不卡资金、不死循环（T4/T8/T13 钉住）。

---

## File Structure

```
x-workers-home/
├── docker-compose.yml               # dev：postgres + redis
├── docker-compose.prod.yml          # prod：+ api / web / caddy
├── .env.example                     # 全部环境变量（见 T1）
├── .gitignore
├── tools/x.py                       # 拷贝自 x-aggregate-data skill（保持上游原样，不修改）
├── backend/
│   ├── Dockerfile                   # node + python3
│   ├── package.json / tsconfig.json / nest-cli.json
│   ├── src/
│   │   ├── main.ts / app.module.ts
│   │   ├── config/database.config.ts
│   │   ├── common/                  # money.ts(微单位工具) guards/ decorators/ errors.ts
│   │   ├── auth/                    # 钱包签名登录: nonce/verify/refresh + jwt.strategy
│   │   ├── users/                   # user.entity + users.service
│   │   ├── xscraper/                # xscraper.service.ts + types.ts（child_process 包 tools/x.py）
│   │   ├── bindings/                # x_bindings 流程 + 钱包改绑申请
│   │   ├── ratings/                 # rating.ts(纯函数) + ratings.service（周刷新定时）
│   │   ├── jobs/                    # verification_jobs 表 + scheduler.service（通用轮询器）
│   │   ├── ledger/                  # accounts + ledger_entries + ledger.service（全部资金原语）
│   │   ├── deposits/                # deposit.entity + chain-provider.ts + bsc-watcher.service
│   │   ├── withdrawals/             # withdrawal.entity + withdrawals.service + admin 审核 API
│   │   ├── referral/                # referral.entity + referral.service
│   │   ├── orders/                  # order.entity + orders.service/controller
│   │   ├── slots/                   # order-slot.entity + slots.service（抢单/交付）
│   │   ├── verification/            # checks.ts(纯函数) + verification.service（消费 jobs）
│   │   ├── settlement/              # settlement.service（确认/自动放款/存活复检/订单到期）
│   │   ├── disputes/                # dispute.entity + disputes.service（含删帖举报追回）
│   │   ├── reviews/                 # review.entity + reviews.service
│   │   ├── notifications/           # notification.entity + service
│   │   ├── terms/                   # terms.entity + service（版本化）
│   │   └── admin/                   # admin 登录/抽查/罚则/对账 + articles(条款)
│   └── test/                        # e2e + fixtures/ + network/(默认跳过)
└── frontend/
    ├── Dockerfile
    ├── src/app/                     # 大厅 page.tsx / orders/[id] / me/tasks / wallet / u/[handle]
    │   ├── admin/…                  # 后台页（T24）
    │   └── api/og/…                 # OG 分享图（next/og）
    ├── src/components/              # OrderCard / Countdown / Stars / RatingBadge / WalletConnect
    └── src/lib/                     # api.ts(axios+JWT) / format.ts(金额格式化)
```

---

## Phase 0 · 基座

### Task 1: 仓库脚手架、健康检查、docker-compose(dev)

**Files:**
- Create: `x-workers-home/backend/package.json`、`backend/tsconfig.json`、`backend/nest-cli.json`、`backend/src/main.ts`、`backend/src/app.module.ts`、`backend/src/health/health.controller.ts`
- Create: `x-workers-home/docker-compose.yml`、`.env.example`、`.gitignore`
- Test: `x-workers-home/backend/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `GET /api/health → {status:'ok'}`；全局 `main.ts` 约定（prefix `api`、ValidationPipe、CORS `FRONTEND_URL`、端口 `PORT||4001`）供后续所有任务复用

- [ ] **Step 1: 写失败测试** `backend/test/health.e2e-spec.ts`

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GET /api/health', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => app.close());

  it('returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd x-workers-home/backend && npm i && npx jest test/health.e2e-spec.ts`
Expected: FAIL（`Cannot find module '../src/app.module'`）

- [ ] **Step 3: 最小实现**

`backend/package.json` 依赖（对齐 english-platform）：`@nestjs/common@^10 @nestjs/core@^10 @nestjs/platform-express@^10 @nestjs/config@^3 @nestjs/jwt@^10 @nestjs/passport@^10 @nestjs/schedule@^4 @nestjs/typeorm@^10 typeorm@^0.3.19 pg@^8.11 passport@^0.7 passport-jwt@^4 bcrypt@^5 ethers@^6 class-validator@^0.14 class-transformer@^0.5 dotenv@^16 uuid@^9`；dev：`@nestjs/cli@^10 @nestjs/testing@^10 @types/* jest ts-jest supertest typescript ts-node`。scripts：`start:dev`(nest start --watch)、`build`、`test`(jest 单测)、`test:e2e`(jest --config ./test/jest-e2e.json)、`migration:run`/`migration:generate`（沿用 english-platform 的 typeorm-ts-node-commonjs -d src/config/database.config.ts）。

`src/main.ts`（照 english-platform 模式）：

```ts
import * as dotenv from 'dotenv'; dotenv.config();
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.FRONTEND_URL || 'http://localhost:4000', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(process.env.PORT || 4001);
}
bootstrap();
```

`src/app.module.ts`：空壳 `@Module({ imports: [], controllers: [HealthController] })`；`health.controller.ts`：`@Controller('health') @Get() → {status:'ok'}`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd x-workers-home/backend && npx jest test/health.e2e-spec.ts`
Expected: PASS

- [ ] **Step 5: compose / env / gitignore**

`docker-compose.yml`（dev）：`postgres:16-alpine`（POSTGRES_USER=platform_user / DB=xwh / 端口 5432 / volume）+ `redis:7-alpine`（端口 6379）。`.env.example` 全量枚举：

```
PORT=4001
FRONTEND_URL=http://localhost:4000
DB_HOST=localhost  DB_PORT=5432  DB_USERNAME=platform_user  DB_PASSWORD=dev_password  DB_DATABASE=xwh
DB_DATABASE_TEST=xwh_test
JWT_SECRET=change_me  JWT_REFRESH_SECRET=change_me2
BSC_RPC_URL=https://bsc-dataseed.binance.org
PLATFORM_WALLET_ADDRESS=0x...
USDT_BEP20_CONTRACT=0x55d398326f99059fF775485246999027B3197955
DEPOSIT_MIN_CONFIRMATIONS=15
XSCRAPER_PYTHON=python
XSCRAPER_SCRIPT=../tools/x.py
ALERT_WEBHOOK_URL=
```

`.gitignore`：`node_modules/ dist/ .next/ .env *.log`。

- [ ] **Step 6: Commit**

```bash
git add x-workers-home
git commit -m "feat(xwh): 后端脚手架、健康检查、dev compose"
```

### Task 2: 数据库接入、首个迁移（users/auth 表）、seed admin

**Files:**
- Create: `backend/src/config/database.config.ts`、`backend/src/users/user.entity.ts`、`backend/src/auth/entities/refresh-token.entity.ts`、`backend/src/auth/entities/auth-nonce.entity.ts`
- Create: `backend/src/database/migrations/1700000000000-init-auth.ts`、`backend/src/database/seed-admin.ts`
- Modify: `backend/src/app.module.ts`（接 TypeOrmModule）
- Test: `backend/test/db.e2e-spec.ts`

**Interfaces:**
- Consumes: T1 的 AppModule/main 约定
- Produces: `User` 实体（字段见下）、`RefreshToken`、`AuthNonce`；`npm run migration:run` 可建表、`npm run seed:admin` 可造管理员；后续所有模块通过 TypeORM repository 访问库
- 约定：所有地址存**小写**；金额列一律 `bigint`

- [ ] **Step 1: 写失败测试** `backend/test/db.e2e-spec.ts`

```ts
// 前置：docker compose up -d postgres；测试库 env 用 .env.test（DB_DATABASE=xwh_test）
import { DataSource } from 'typeorm';
import dataSourceForTest from '../src/config/database.config'; // 测试只需同配置

describe('migrations', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = dataSourceForTest;
    if (!ds.isInitialized) await ds.initialize();
    await ds.runMigrations();
  });
  afterAll(async () => ds.destroy());

  it('users 表可读写', async () => {
    const repo = ds.getRepository('users');
    await repo.insert({ id: '11111111-1111-1111-1111-111111111111', address: '0xabc', status: 'pending_x_binding', role: 'user' });
    const row: any = await repo.findOne({ where: { address: '0xabc' } });
    expect(row.status).toBe('pending_x_binding');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd x-workers-home/backend && docker compose up -d postgres && npm run migration:run && npx jest test/db.e2e-spec.ts`
Expected: FAIL（表不存在 / 迁移空）

- [ ] **Step 3: 实现**

`database.config.ts`（照 english-platform，加 `entities: [__dirname + '/../**/*.entity{.ts,.js}']`、migrations glob、`synchronize:false`）。`app.module.ts` 加 `TypeOrmModule.forRoot({...同配置, autoLoadEntities:false})` + `ScheduleModule.forRoot()`（本轮先不加 Schedule，T5 再加）。

迁移 `init-auth` 建三张表：

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address varchar(42) NOT NULL UNIQUE,            -- 小写 BSC 地址 = 登录身份
  status varchar(24) NOT NULL DEFAULT 'pending_x_binding', -- pending_x_binding|active|suspended
  role varchar(16) NOT NULL DEFAULT 'user',       -- user|admin
  password_hash varchar(72),                      -- 仅 admin 用
  nickname varchar(64),
  rating_grade varchar(2),                        -- 冗余展示列，T6 维护
  violations int NOT NULL DEFAULT 0,
  suspended_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_nonces (address varchar(42) PRIMARY KEY, nonce varchar(64) NOT NULL, expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false);
CREATE TABLE refresh_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), token_hash varchar(64) NOT NULL, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false);
```

`seed-admin.ts`：读 `ADMIN_ADDRESS/ADMIN_PASSWORD` env（new：加到 .env.example）→ upsert 一个 `role='admin'`、`status='active'` 的用户（password 走 bcrypt，供 T17 后台登录）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run migration:run && npx jest test/db.e2e-spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add x-workers-home/backend
git commit -m "feat(xwh): TypeORM 接入、init-auth 迁移、seed admin"
```

---

## Phase 1 · 账号：钱包签名、X 绑定、评级

### Task 3: 钱包签名登录（nonce → verify → JWT access/refresh）

**Files:**
- Create: `backend/src/auth/auth.module.ts`、`auth.service.ts`、`auth.controller.ts`、`jwt.strategy.ts`、`dto/*.ts`
- Create: `backend/src/common/guards/jwt-auth.guard.ts`、`backend/src/common/decorators/current-user.decorator.ts`
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: T2 的 `users/auth_nonces/refresh_tokens`
- Produces（后续任务全用它）：
  - `POST /api/auth/nonce` `{address}` → `{nonce, message}`
  - `POST /api/auth/verify` `{address, signature}` → `{accessToken, refreshToken, user:{id,address,status,role,rating_grade}}`（首次调用即注册，`status='pending_x_binding'`）
  - `POST /api/auth/refresh` `{refreshToken}` → 同上（轮换，旧 token 作废）
  - `GET /api/auth/me`（JWT）
  - 守卫：`JwtAuthGuard`（挂 `req.user = {userId, role, status}`）；`CurrentUser()` 装饰器
  - 消息格式（固定）：`"X工作者之家 登录\n地址: ${address}\nNonce: ${nonce}"`；验证用 `ethers.verifyMessage`

- [ ] **Step 1: 写失败测试** `backend/test/auth.e2e-spec.ts`

```ts
// 用 ethers.Wallet.createRandom() 现造钱包签名
it('完整流程：nonce → verify 注册 → me', async () => {
  const w = ethers.Wallet.createRandom();
  const { body: n } = await request(app).post('/api/auth/nonce').send({ address: w.address }).expect(201);
  const sig = await w.signMessage(n.message);
  const { body: v } = await request(app).post('/api/auth/verify').send({ address: w.address, signature: sig }).expect(201);
  expect(v.user.status).toBe('pending_x_binding');
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${v.accessToken}`).expect(200);
});
it('nonce 一次性：复用被拒', async () => { /* 用同 nonce 再验 → 401 */ });
it('错误签名被拒', async () => { /* 别的钱包的签名 → 401 */ });
it('refresh 轮换：旧 refresh 立即失效', async () => { /* 两次 refresh，第一次的 token 第二次用 → 401 */ });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest test/auth.e2e-spec.ts`
Expected: FAIL（404）

- [ ] **Step 3: 实现**

nonce：`crypto.randomBytes(16).toString('hex')`，10 分钟过期，`used` 单次（verify 事务内 `UPDATE ... SET used=true WHERE address=? AND used=false AND expires_at>now() RETURNING *`，无行即 401）。verify：`ethers.verifyMessage(message, signature)` 与 address 比对（都小写）；address 不存在 → 建号（默认 status）；签发 access（15m，payload `{sub, role}`）+ refresh（7d，DB 存 sha256 hash）；旧 refresh 用后置 `revoked=true`。JWT 策略：`passport-jwt` 从 `Authorization: Bearer` 取。

- [ ] **Step 4: 跑测试确认通过** → 全绿。

- [ ] **Step 5: Commit**

```bash
git add x-workers-home/backend
git commit -m "feat(xwh): 钱包签名登录与 JWT 会话"
```

### Task 4: X 抓取服务（`tools/x.py` 的 child_process 封装）

**Files:**
- Create: `x-workers-home/tools/x.py`（**原样拷贝** `C:\Users\04\.claude\skills\x-aggregate-data\scripts\x.py`，文件头注释注明来源与上游路径；不修改逻辑）
- Create: `backend/src/xscraper/xscraper.service.ts`、`xscraper.types.ts`、`command-runner.ts`（可注入的 spawn 封装，便于测试）
- Create: `backend/test/fixtures/x_user.json`、`x_tweets.json`、`x_tweet.json`（按 x.py 源码归一化结构缩编：user 含 `handle, name, id, followers, following, verified, joined, bio, tweets, likes, media_count, about`；tweet 含 `id, url, created_at, author{handle}, text, views, likes, reposts, quotes, replies, bookmarks, reply_to`）
- Test: `backend/src/xscraper/xscraper.service.spec.ts`（单测，注入 fake runner）

**Interfaces:**
- Consumes: T1 的 env（`XSCRAPER_PYTHON`/`XSCRAPER_SCRIPT`）
- Produces（T5/T6/T13 用）：
  - `getProfile(handle: string): Promise<XUser>`
  - `getRecentTweets(handle: string, limit: number): Promise<XTweet[]>`
  - `getTweet(url: string): Promise<XTweet>`
  - 错误类型：`XNotFoundError`（x.py 退出码 4 / error 字段）、`XRateLimitError`（5）、`XUpstreamError`（1、超时、输出不可解析）
  - CLI 映射：`user <handle>` → `{"user":…}`；`tweets <handle> --limit N` → `{"tweets":[…]}`；`tweet <url>` → `{"tweet":…}`；stdout 为单行 JSON

- [ ] **Step 1: 写失败测试**（用 fixture 字符串喂 fake runner）

```ts
it('解析 user 输出', async () => {
  const svc = new XScraperService(fakeRunner(fixture('x_user.json')), cfg);
  const u = await svc.getProfile('alice');
  expect(u.handle).toBe('alice'); expect(u.followers).toBe(12345);
  expect(u.joined).toBe('2021-03-05T00:00:00Z');
});
it('退出码 4 → XNotFoundError', async () => { /* runner 抛 {code:4, stdout:{error:'没找到...'}} */ });
it('超时 30s → XUpstreamError', async () => { /* runner 抛 timeout */ });
it('非 JSON stdout → XUpstreamError', async () => { /* 'Traceback...' */ });
```

- [ ] **Step 2: 跑测试确认失败** → `npx jest src/xscraper/xscraper.service.spec.ts` FAIL。

- [ ] **Step 3: 实现**

`command-runner.ts`：`spawn(python, [script, ...args], {env, timeout})`，收集 stdout/stderr，30s 超时 kill；把 `{code, stdout, stderr}` 返回。`XScraperService.run()`：spawn → `JSON.parse(stdout)`（失败→Upstream）；若 `obj.error` 存在按 `code`/文案映射（`没找到` → NotFound）；退出码兜底：4→NotFound、5→RateLimit、其余非 0→Upstream。注意 Windows 开发机 `python`、Linux `python3`——由 env `XSCRAPER_PYTHON` 决定。

- [ ] **Step 4: 跑测试确认通过**；另加一个 `test/network/xscraper.network.spec.ts`（标 `describe.skip` 默认跳过；说明本机需 `HTTPS_PROXY`，VPS 直连）。

- [ ] **Step 5: Commit**

```bash
git add x-workers-home/tools x-workers-home/backend
git commit -m "feat(xwh): X 抓取服务（x.py 封装）与 fixture"
```

### Task 5: X 绑定流程 + 通用任务轮询器（verification_jobs 基座）

**Files:**
- Create: `backend/src/jobs/verification-job.entity.ts`、`backend/src/jobs/scheduler.service.ts`（通用：每 30s 捞到期 jobs 回调分派）
- Create: `backend/src/bindings/x-binding.entity.ts`、`binding-change.entity.ts`、`bindings.service.ts`、`bindings.controller.ts`
- Create: `backend/src/notifications/notification.entity.ts`、`notifications.service.ts`、`notifications.controller.ts`（全站通知基座）
- Create: `backend/src/database/migrations/1700000001000-x-bindings-jobs.ts`
- Test: `backend/test/x-binding.e2e-spec.ts`

**Interfaces:**
- Consumes: T4 `getProfile/getRecentTweets`；T3 `JwtAuthGuard`
- Produces：
  - `POST /api/bindings/x/start {handle}`（JWT）→ `{code: "XWH-XXXXXX"}`（大写 6 位，24h 有效）
  - `GET /api/bindings/x/status`（JWT）→ `{status: none|pending|active|manual_review, handle}`
  - `verification_jobs` 通用表：`id, type('x_binding'|'delivery'), ref_id, payload jsonb, status('pending'|'done'|'failed'|'manual'), attempts, next_run_at, last_error, created_at`；`SchedulerService.register(type, handler)`，30s 轮询 `status='pending' AND next_run_at<=now()` 并分派；重试退避 `[1m,3m,10m,30m]`，第 4 次后 → `manual`
  - 绑定判定：profile.bio 含 code **或** 最近 5 条推文中含 code（`created_at` 在 start 之后）→ `x_bindings.status='active'` + `users.status='active'`（若钱包已绑即双绑齐）；handle 冲突（已被他人绑定/大小写去重）→ 409
  - `x_bindings` 表：`id, user_id unique, handle unique(小写), code, status, verified_at`
  - **通知基座（全站复用）**：`notifications` 表 `(id, user_id, kind, title, body, ref_type, ref_id, read_at null, created_at)` + `NotificationsService.notify(tx, {userId, kind, title, body, ref?})`（事务内落库）、`GET /api/notifications`、`POST /api/notifications/:id/read`——**T12/T13/T14/T15/T16 里说的「通知」全部指它**
  - **改绑流程**（钱包和 X 都要）：`binding_changes` 表 `(id, user_id, kind('wallet'|'x'), new_value, status('pending'|'approved'|'rejected'), effective_at, created_at)`；`POST /api/bindings/wallet/change`（需新地址 EVM 签名）+ `POST /api/bindings/x/change`（复用验证码流程）→ `effective_at = now+24h`；**存在未生效改绑时提现一律 400**（T9 配合执行）；冷静期到且 admin 审核通过（T17）后由轮询器落库生效

- [ ] **Step 1: 写失败测试**

```ts
it('bio 含验证码 → 绑定成功且用户 active', async () => {
  // fake scraper 返回 {bio:'...XWH-ABC123...'}；start 后手动跑一次 scheduler tick → status active
});
it('最近推文含验证码 → 绑定成功', async () => { /* fake 返回 tweets 里带 code */ });
it('未匹配 → 重试入队（attempts+1, next_run_at 后移）', async () => { /* tick 两次断言 attempts */ });
it('4 次失败 → manual', async () => {});
it('handle 已被别的账号绑定 → 409', async () => {});
it('改绑流程：申请后提现被拦；24h+admin 通过后新地址生效', async () => {});
it('通知基座：绑定成功/失败各落一条 notification', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
// bindings.service.ts 核心
async start(userId: string, handle: string) {
  const h = handle.replace(/^@/, '').toLowerCase();
  const exists = await this.xBindRepo.findOne({ where: { handle: h } });
  if (exists && exists.userId !== userId) throw new ConflictException('该 X 账号已被绑定');
  const code = 'XWH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  await this.xBindRepo.upsert({ userId, handle: h, code, status: 'pending' }, ['userId']);
  await this.jobs.enqueue('x_binding', userId, /* payload */ { code, handle: h });
}
async handleJob(job) {  // 由 SchedulerService 回调
  const { code, handle } = job.payload;
  const p = await this.scraper.getProfile(handle);           // XNotFoundError → 重试
  let ok = (p.bio || '').toUpperCase().includes(code);
  if (!ok) {
    const tw = await this.scraper.getRecentTweets(handle, 5);
    ok = tw.some(t => (t.text || '').toUpperCase().includes(code));
  }
  ok ? this.activate(binding) : this.reschedule(job);        // reschedule 超限 → manual
}
```

- [ ] **Step 4: 跑测试确认通过**；`GET /api/auth/me` 现在应带绑定状态（扩展返回）。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): X 绑定流程与任务轮询器"
```

### Task 6: 账户评级（纯函数 + 周刷新）

**Files:**
- Create: `backend/src/ratings/rating.ts`（纯函数，无 IO）、`ratings.service.ts`、`user-rating.entity.ts`、`ratings.controller.ts`（`GET /api/ratings/:handle` 公开）
- Create: `backend/src/database/migrations/1700000002000-ratings.ts`
- Test: `backend/src/ratings/rating.spec.ts`（纯函数，重点）+ `backend/test/ratings.e2e-spec.ts`

**Interfaces:**
- Consumes: T4 `getProfile/getRecentTweets`；T2 `users.rating_grade`
- Produces：
  - `computeRating(input: RatingInput): {score: number; grade: 'S'|'A'|'B'|'C'|'D'; flags: string[]; breakdown: Record<string,number>}`
  - `RatingInput = {followers, following, joinedISO, tweets: {views, likes, reposts, replies, bookmarks}[]}`
  - v1 公式（权重常量写死 + 注释标明可调）：`followers=30%: clamp(log10(f+1)/6) ｜ avg_views=25%: clamp(log10(v+1)/5.5) ｜ engagement=25%: clamp(rate/0.05)，rate=(likes+reposts+replies+bookmarks)/max(views,1) ｜ age=10%: clamp(days/1825) ｜ ratio=10%: clamp(1 - following/(followers+1))`；总分 `Math.round(Σ*100)`；grade：`≥85 S / ≥70 A / ≥55 B / ≥40 C / else D`；数据缺失（views 全 null 或 joined 空）→ 对应权重剔除、其余重新归一；**刷粉旗标**：`followers≥1000 && rate<0.002` → `flags+['brush']` 且 grade 封顶 C
  - `GET /api/ratings/:handle` → `{handle, score, grade, flags, breakdown, computed_at}`
  - 周任务：每周一 03:00 UTC 批量刷新（顺序 + 500ms 间隔），失败跳过记日志；入驻完成绑定时立即算一次（T5 激活后调用）

- [ ] **Step 1: 写失败测试**（钉死公式）

```ts
it('10k 粉丝 / 2 万均浏览 / 2% 互动 / 5 年 / 关注 1k → B(69)', () => {
  const r = computeRating({ followers: 10000, following: 1000, joinedISO: isoDaysAgo(1825),
    tweets: Array.from({length: 20}, () => ({ views: 20000, likes: 300, reposts: 50, replies: 50, bookmarks: 0 })) });
  expect(r.score).toBe(69); expect(r.grade).toBe('B');
});
it('0 粉 → D', ...); it('刷粉旗标封顶 C', ...); it('views 全 null → 重新归一不崩', ...);
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现** `rating.ts`（严格按上式）+ `ratings.service.ts`（拉 X 数据组装 input、upsert `user_ratings(user_id, score, grade, flags jsonb, breakdown jsonb, computed_at)`、同步 `users.rating_grade`）。

- [ ] **Step 4: 跑测试确认通过**（含 e2e：mock scraper → 返回评级 → 用户表 grade 更新）。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 账户评级与周刷新"
```

---

## Phase 2 · 资金

### Task 7: 账本核心（accounts / ledger_entries / 资金原语）— 全项目最关键的一个任务

**Files:**
- Create: `backend/src/ledger/account.entity.ts`、`ledger-entry.entity.ts`、`ledger.service.ts`
- Create: `backend/src/common/money.ts`、`backend/src/common/errors.ts`（`InsufficientFundsError` 等）
- Create: `backend/src/database/migrations/1700000003000-ledger.ts`
- Test: `backend/src/common/money.spec.ts` + `backend/test/ledger.e2e-spec.ts`

**Interfaces:**
- Consumes: T2 的 DataSource
- Produces（**全项目资金唯一入口**，T8–T18 全部依赖，签名必须原样使用）：

```ts
export type AccountRef = { userId: string } | { platform: 'escrow' | 'income' };

class LedgerService {
  // 所有方法第一个参数都是调用方事务的 EntityManager；锁用 pessimistic_write，按 account.id 排序防死锁
  getOrCreateAccount(tx: EntityManager, ref: AccountRef): Promise<Account>;
  transfer(tx: EntityManager, p: { from: AccountRef; to: AccountRef; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef; memo?: string }): Promise<void>;
  freezeAvailable(tx: EntityManager, p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef }): Promise<void>;   // 用户可用→用户冻结（提现申请）
  unfreeze(tx: EntityManager, p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef }): Promise<void>;          // 冻结→可用（提现驳回）
  consumeFrozen(tx: EntityManager, p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef }): Promise<void>;     // 冻结→出系统（打款完成）
  credit(tx: EntityManager, p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef }): Promise<void>;            // 系统外→用户可用（充值入账）
  forfeitAll(tx: EntityManager, p: { userId: string; ref: LedgerRef }): Promise<bigint>;                                             // 没收：可用+冻结全部→platform_income，返回没收额
}

type LedgerKind = 'deposit_credit'|'order_freeze'|'order_refund'|'posting_fee'|'slot_payout'
  |'completion_fee'|'withdrawal_hold'|'withdrawal_reject'|'withdrawal_paid'|'referral_rebate'|'forfeit'|'deletion_clawback';
type LedgerRef = { type: 'order'|'slot'|'withdrawal'|'deposit'|'user'; id: string };
```

- `common/money.ts`：

```ts
export const MICRO = 1_000_000n;
export function pctFloor(amount: bigint, num: number, den: number): bigint { return (amount * BigInt(num)) / BigInt(den); } // 手续费一律 floor
export function parseXm(s: string): bigint;      // "100" / "100.5" → micro；>6 位小数字符 → 抛错；负/空 → 抛错
export function formatXm(m: bigint): string;     // micro → 十进制字符串（去尾零）
export function fromWei18(s: string): bigint;    // 链上 18 位小数字符串 → micro（向下取整）
```

- 表结构：`accounts(id uuid pk, owner_user_id uuid null unique, kind varchar(16), available bigint not null default 0, frozen bigint not null default 0)`——迁移里预置两行平台账户（固定 UUID：`escrow` 与 `platform_income`，`owner_user_id=null`，`kind` 区分）；`ledger_entries(id uuid pk, account_id uuid, user_id uuid null, kind, ref_type, ref_id uuid, available_delta bigint, frozen_delta bigint, available_after bigint, frozen_after bigint, memo, created_at)`——每次 `transfer` 写 **两行**（转出方/转入方），同 `ref`；用户账户与平台账户全部有流水。
- 不变量（测试逐条钉住）：任何操作前后 `Σ(所有账户.available + 所有账户.frozen)`——`credit` 增加对应额、`consumeFrozen` 减少、`forfeitAll`/`transfer`/`freezeAvailable`/`unfreeze` 不变。

- [ ] **Step 1: 写失败测试**

`money.spec.ts`：

```ts
expect(pctFloor(50_000_000n, 5, 100)).toBe(2_500_000n);   // 50 XM 的 5% = 2.5
expect(pctFloor(33_333_333n, 5, 100)).toBe(1_666_666n);   // floor，不四舍五入
expect(parseXm('100.5')).toBe(100_500_000n);
expect(() => parseXm('0.0000001')).toThrow();
expect(formatXm(100_500_000n)).toBe('100.5');
expect(fromWei18('100.123456789012345678')).toBe(100_123_456n);
```

`ledger.e2e-spec.ts`（真库，事务）：

```ts
const sumAll = async (tx) => { /* SELECT sum(available+frozen) —— 所有账户 */ };
it('transfer 前后总额不变；冻结→驳回往返无损', async () => { /* credit 100 → freeze 20 → unfreeze 20 → 断言逐笔前后总额与终额 */ });
it('余额不足抛 InsufficientFundsError，且分毫未动', async () => {});
it('consumeFrozen 让系统总额减少对应额', async () => {});
it('并发：100 XM 余额上并发 5 笔 30 XM 转出 → 恰 3 笔成功、总额一致、无负数', async () => { /* Promise.all 各自独立事务 */ });
it('forfeitAll 把可用+冻结清零并全进 income', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → `npx jest src/common/money.spec.ts test/ledger.e2e-spec.ts` FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
async transfer(tx, { from, to, amountMicro, kind, ref, memo }) {
  if (amountMicro <= 0n) throw new BadRequestException('金额必须为正');
  const [a, b] = await this.lockTwo(tx, from, to);      // 按 id 排序 pessimistic_write 全锁
  if (a.available < amountMicro) throw new InsufficientFundsError();
  a.available -= amountMicro; b.available += amountMicro;
  await tx.save([a, b]);
  await tx.insert(LedgerEntry, [entryOf(a, -amountMicro, 0n, kind, ref, memo), entryOf(b, amountMicro, 0n, kind, ref, memo)]);
}
// freezeAvailable/unfreeze/consumeFrozen/credit/forfeitAll 同理只动 ±available/±frozen 并留流水
```

- [ ] **Step 4: 跑测试确认通过**（全绿才算过——这是全项目地基）。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 账本核心与资金原语"
```

### Task 8: 充值（BSC 监听 + from 地址自动匹配 + 1:1 入账）

**Files:**
- Create: `backend/src/deposits/deposit.entity.ts`、`chain-cursor.entity.ts`、`chain-provider.ts`（接口）、`bsc-chain-provider.ts`（ethers v6）、`bsc-watcher.service.ts`、`deposits.service.ts`、`deposits.controller.ts`
- Create: `backend/src/database/migrations/1700000004000-deposits.ts`
- Test: `backend/test/deposits.e2e-spec.ts`（注入 `FakeChainProvider`）

**Interfaces:**
- Consumes: T7 `ledger.credit`；T2/3 users.address（小写即充值匹配键）
- Produces：
  - `ChainProvider` 接口：`getLatestBlock(): Promise<number>`；`getUsdtTransfers(p: {to: string; fromBlock: number; toBlock: number}): Promise<{txHash: string; logIndex: number; from: string; to: string; amountWei: string; blockNumber: number}[]>`
  - `BscWatcherService.tick(): Promise<void>`——每 30s 跑：`latest - 15` 之前无新块则跳过；拉 `(cursor, latest-15]`；逐条处理：`txHash+logIndex` 已存在 → 跳过（幂等）；`from` 匹配**小写** users.address → 事务内 `credit(amountMicro, 'deposit_credit')` + `deposits.status='credited'`、`userId`；匹配不上 → `status='unmatched'`；最后推进 `chain_cursors.last_block`
  - `DepositsService.listMine(userId)`；`DepositsService.claimTo(depositId, userId)`（把 unmatched 挂给某用户，T17 开 HTTP）
  - 金额：`fromWei18(amountWei)` 向下取整到 micro；`USDT_BEP20_CONTRACT` 默认 `0x55d398326f99059fF775485246999027B3197955`

- [ ] **Step 1: 写失败测试**

```ts
it('绑定钱包转入 100.5 USDT → 自动入账 100.5 XM，deposit.credited', async () => {});
it('陌生地址转入 → unmatched，不入账', async () => {});
it('同一 log 二次 tick 重放 → 幂等（不重复入账）', async () => {});
it('latest 块上的转账在 15 确认前不处理', async () => {});
it('provider 抛错 → tick 不崩、cursor 不前进', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
// bsc-chain-provider.ts
const provider = new ethers.JsonRpcProvider(env.BSC_RPC_URL);
const usdt = new ethers.Contract(env.USDT_BEP20_CONTRACT, ['event Transfer(address indexed from, address indexed to, uint256 value)'], provider);
async getUsdtTransfers({ to, fromBlock, toBlock }) {
  return (await usdt.queryFilter(usdt.filters.Transfer(null, to), fromBlock, toBlock))
    .map(e => ({ txHash: e.transactionHash, logIndex: e.index, from: e.args[0].toLowerCase(), to: e.args[1].toLowerCase(), amountWei: e.args[2].toString(), blockNumber: e.blockNumber }));
}
// bsc-watcher.service.ts：@Interval(30_000) → this.tick()（包 try/catch，全错只记日志）
```

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): BSC 充值监听与自动入账"
```

### Task 9: 提现（规则校验 + 立即扣款 + 人工审核流）

**Files:**
- Create: `backend/src/withdrawals/withdrawal.entity.ts`、`withdrawals.service.ts`、`withdrawals.controller.ts`
- Create: `backend/src/database/migrations/1700000005000-withdrawals.ts`
- Modify: `backend/src/referral/referral.service.ts` 无——本任务只挂 `ledger`；提现费返佣钩子在 T10 接
- Test: `backend/test/withdrawals.e2e-spec.ts`

**Interfaces:**
- Consumes: T7 `freezeAvailable/unfreeze/consumeFrozen`；T3 `JwtAuthGuard`
- Produces：
  - `POST /api/withdrawals/request {amountXm: string}`（JWT）→ `{id, amountXm, feeXm, payoutXm, status:'pending'}`；**仅可提至绑定钱包**（地址取用户绑定地址，不接受用户传地址）
  - `GET /api/withdrawals/mine`（含 `isFirst` 标记 = 无任何已打款记录）
  - `WithdrawalsService`（T17 开 HTTP）：`approve(id, adminId)` → `status='approved'`；`markPaid(id, txHash, adminId)` → 事务内 `consumeFrozen(amount, 'withdrawal_paid')` + `status='paid'`；`reject(id, reason, adminId)` → `unfreeze(amount, 'withdrawal_reject')` + `status='rejected'`
  - 校验（全部服务端，测试逐条钉住）：绑定钱包存在；`amount ≥ 50 XM`；`amount % 10 XM == 0`（micro：`% 10_000_000n === 0n`）；**24h 冷却** = 不存在本人 `status IN ('pending','approved','paid')` 且 `created_at > now() - 24h` 的记录（滚动窗口；`rejected` 不计）；无未生效的改绑申请（与 T5 联动：存在则 400）；余额足够（`freezeAvailable` 兜底）
  - 费用：`feeMicro = pctFloor(amount, 10, 100)`；`payoutMicro = amount - feeMicro`

- [ ] **Step 1: 写失败测试**

```ts
it('50 XM 申请 → fee 5 / payout 45 / 余额转冻结', async () => {});
it('49 XM → 400（门槛）；55 XM → 400（非整十）；50.5 → 400', async () => {});
it('24h 内第二笔 → 400；恰在 24h 前的一笔不拦', async () => {});
it('rejected 后立即重发 → 允许', async () => {});
it('markPaid 后系统总额减 payout，冻结清零', async () => {});
it('未绑定钱包 → 400', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
async request(userId, amountXm: string) {
  const amount = parseXm(amountXm);
  if (amount < 50n * MICRO) throw new BadRequestException('最低提现 50 XM');
  if (amount % (10n * MICRO) !== 0n) throw new BadRequestException('提现金额必须是 10 的整数倍');
  await this.assertCooldown(userId);                      // 24h 滚动
  const wallet = await this.users.getBoundWallet(userId); // 未绑定 → 400
  const fee = pctFloor(amount, 10, 100);
  return this.dataSource.transaction(async tx => {
    await this.ledger.freezeAvailable(tx, { userId, amountMicro: amount, kind: 'withdrawal_hold', ref: { type: 'user', id: userId } });
    return tx.save(Withdrawal, { userId, address: wallet, amountMicro: amount, feeMicro: fee, payoutMicro: amount - fee, status: 'pending' });
  });
}
```

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 提现规则与人工审核流"
```

### Task 10: 邀请返佣（20/30/40 档位 + 手续费事件钩子）

**Files:**
- Create: `backend/src/referral/referral.entity.ts`、`referral.service.ts`、`referral.controller.ts`
- Create: `backend/src/database/migrations/1700000006000-referrals.ts`
- Modify: `backend/src/auth/auth.service.ts`（注册时可带 `referralCode`，见下）
- Test: `backend/test/referral.e2e-spec.ts`

**Interfaces:**
- Consumes: T7 `transfer(income → 用户)`；T9 `markPaid`（挂接钩子）
- Produces：
  - `ref_code`：每用户一个（建号时生成，6 位 base32，唯一）；注册接口 `POST /api/auth/verify` 增加可选字段 `referralCode` → 绑定邀请关系（仅注册时、不能自邀、一人只能被绑一次）
  - `ReferralService.onFeeEvent(tx, {userId, feeMicro, feeKind})`——**所有平台手续费入账处调用**（T9 `markPaid` 的提现费、T11 发单费、T14 完结费；后两个任务在自己的步骤里调用）：查 `userId` 的邀请人 → 档位 = 邀请人已绑定且 active 的被邀人数：`0-4 → 20%`、`5-9 → 30%`、`≥10 → 40%` → `rebate = pctFloor(feeMicro, rate, 100)` → `transfer(income → 邀请人可用, kind='referral_rebate')`；无邀请人则跳过
  - `GET /api/referral/mine`（JWT）→ `{code, inviteesCount, tier, rebateTotalXm}`
- 说明：返佣基数是**手续费**（发单/完结/提现），以 XM 发放、来源为 platform_income（记账即营销支出）

- [ ] **Step 1: 写失败测试**

```ts
it('档位：0-4 人 20% / 满 5 人 30% / 满 10 人 40%', async () => { /* 构造 4/5/9/10 个 active 被邀人 */ });
it('被邀人产生 5 XM 完结费 → 邀请人 20% 档得 1 XM', async () => { /* 直接调 onFeeEvent */ });
it('自邀被拒；二次绑定被拒', async () => {});
it('被邀人提现 markPaid → 提现费也产生返佣', async () => { /* T9 流程 + 钩子 */ });
it('无邀请人 → 无返佣、无报错', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
async onFeeEvent(tx, { userId, feeMicro, feeKind }) {
  const ref = await tx.findOne(Referral, { where: { inviteeUserId: userId } });
  if (!ref) return;
  const count = await tx.count(Referral, { where: { referrerUserId: ref.referrerUserId } }); // active 才计数
  const rate = count >= 10 ? 40 : count >= 5 ? 30 : 20;
  const rebate = pctFloor(feeMicro, rate, 100);
  if (rebate <= 0n) return;
  await this.ledger.transfer(tx, { from: { platform: 'income' }, to: { userId: ref.referrerUserId }, amountMicro: rebate,
    kind: 'referral_rebate', ref: { type: 'user', id: userId }, memo: `${feeKind} 返佣 ${rate}%` });
}
```

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 邀请返佣与手续费钩子"
```

---

## Phase 3 · 商单与交付

### Task 11: 商单创建 / 公开列表 / 下架退款

**Files:**
- Create: `backend/src/orders/order.entity.ts`、`orders.service.ts`、`orders.controller.ts`
- Create: `backend/src/database/migrations/1700000007000-orders.ts`
- Test: `backend/test/orders.e2e-spec.ts`

**Interfaces:**
- Consumes: T7 `ledger.transfer`；T3 JWT
- Produces：
  - `orders` 表：`id, merchant_user_id, type('post'|'comment'|'quote'), title, brief, requirements jsonb {keywords[],hashtags[],mentions[],links[],minChars?}, target_tweet_url null, price_micro bigint, slots_total int, fee_micro bigint, fee_earned bool default false, escrow_micro bigint, status('recruiting'|'closed'|'completed'), expires_at timestamptz, created_at, closed_at, min_rating_grade varchar(2) null /* 预留：最低评级要求，1.0 不启用 */`
  - **托管不变量（测试全钉住）**：`escrow_micro == P × (slots_total − 已终态名额数) + (fee_earned ? 0 : fee_micro)`，且与 escrow 账户实际余额互为校验
  - `POST /api/orders`（JWT，需 active+双绑）`{type,title,brief,requirements,targetTweetUrl?,priceXm,slots,expiresInDays?}`→ 事务：`transfer(user→escrow, P×N + fee, 'order_freeze')`（**发单费随托管一起冻结，首次被抢单才转 income**——保证「从未有人接单取消全额退」）；`fee = pctFloor(P×N, 5, 100)`；`expires_at = now + 7d`（可传 1-30）
  - 校验：comment/quote 必须传 `targetTweetUrl`（且为 x.com/twitter.com 链接）；`priceXm` 为正整数 XM（≥1）；`slots 1..1000`
  - `GET /api/orders`（**公开免登录**）：默认 `status='recruiting'`，支持 `type/sort(price|new)/page`；每条含 `slotsAvailable`（= slots_total − 非 expired 名额数）、`priceXm`、`payoutXm`（= P − floor(5%)）、商家 `rating_grade`
  - `GET /api/orders/:id`（公开）：单详情 + 名额列表状态
  - `POST /api/orders/:id/close`（JWT merchant）→ 停止招募：退**自由池**（未被接名额）×P；`fee_earned=false` 时连 fee 一起退（全额）；`status='closed'`；已有接单名额继续走完（那是 T12-T14 的事）

- [ ] **Step 1: 写失败测试**

```ts
it('建单冻结数学：P=100,N=3 → 冻结 315、escrow=315、可用减 315', async () => {});
it('comment 缺 targetTweetUrl → 400；price=0 → 400；slots=0 → 400', async () => {});
it('从未被接 → close 全额退（315 回可用、escrow 归零、income 无入账）', async () => {
  // 需要一个「首抢转 fee」钩子先不存在；本任务只测从未接的分支
});
it('列表公开可访问、slotsAvailable 正确', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
// orders.service.ts
async create(userId, dto) {
  const price = parseXm(dto.priceXm); assert(price > 0n && Number.isInteger(...));
  const total = price * BigInt(dto.slots); const fee = pctFloor(total, 5, 100);
  return this.ds.transaction(async tx => {
    await this.ledger.transfer(tx, { from: { userId }, to: { platform: 'escrow' }, amountMicro: total + fee, kind: 'order_freeze', ref: { type: 'user', id: userId } });
    return tx.save(Order, { merchantUserId: userId, ..., priceMicro: price, slotsTotal: dto.slots, feeMicro: fee, escrowMicro: total + fee, status: 'recruiting', expiresAt: daysFromNow(7) });
  });
}
```

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 商单创建、公开列表与下架退款"
```

### Task 12: 抢单（防超卖）与交付、3h 超时

**Files:**
- Create: `backend/src/slots/order-slot.entity.ts`、`slots.service.ts`、`slots.controller.ts`
- Create: `backend/src/database/migrations/1700000008000-slots.ts`
- Test: `backend/test/slots.e2e-spec.ts`

**Interfaces:**
- Consumes: T11 orders；T5 `jobs.enqueue('delivery')`；T7 ledger；T10 `onFeeEvent`
- Produces：
  - `order_slots` 表：`id, order_id, creator_user_id, status('reserved'|'verifying'|'passed'|'disputed'|'paid'|'refunded'|'expired'), accepted_at, deliver_deadline_at(=accepted+3h), delivered_at, delivery_url, last_reject jsonb, verify_snapshot jsonb null, manual_reasons jsonb default '[]', appeal_requested bool default false, confirmed_deadline_at, settled_at, created_at`；唯一约束 `(order_id, creator_user_id, status-active)` 用部分索引实现「一个用户一单只能占一个名额」
  - `POST /api/orders/:id/take`（JWT）——**防超卖的核心**：事务内 `SELECT ... FOR UPDATE` 锁订单行 → 复核 `status='recruiting'` 且未过期 → `count(slots WHERE order_id=? AND status <> 'expired')` 自由池 > 0 → 建 `reserved` 名额；**首次被抢时**：同事务 `transfer(escrow→income, fee_micro, 'posting_fee')` + `order.fee_earned=true` + `referral.onFeeEvent(tx,{userId: order.merchantUserId, feeMicro, feeKind:'posting_fee'})`
  - `POST /api/slots/:id/deliver {deliveryUrl}`（JWT creator）——事务锁名额行：`status='reserved'` 且 `now < deliver_deadline_at` → `status='verifying'`、记 url → 事务外 enqueue `delivery` 核验任务；重复提交同一 url 到多个名额 → 409
  - 超时 cron（60s）：`reserved` 且过期 → `expired` + `users.violations+1` + 站内通知；该名额回到自由池（可被再抢）
  - `GET /api/me/slots`（JWT）→ 我的接单列表（含剩余倒计时字段 `deliverDeadlineAt`）

- [ ] **Step 1: 写失败测试**

```ts
it('并发抢最后 1 个名额：5 个请求并发 → 恰 1 成功 4 失败(400)', async () => {
  // Promise.allSettled；断言成功数 === 1
});
it('同一用户对同一单二次抢 → 400', async () => {});
it('首抢转发单费：escrow 减 fee、income 加 fee、返佣触发', async () => {});
it('3h 过期名额可被他人再抢（回池）', async () => {});
it('过期 → violations+1、通知生成', async () => {});
it('交付：reserved→verifying + 核验任务入队', async () => {});
it('交付竞态：恰在 deadline 时锁内复核 → 过期则 400', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
async take(orderId, userId) {
  return this.ds.transaction(async tx => {
    const order = await tx.getRepository(Order).createQueryBuilder('o').setLock('pessimistic_write').where('o.id=:id', { id: orderId }).getOne();
    if (!order || order.status !== 'recruiting' || order.expiresAt <= new Date()) throw new BadRequestException('该商单不可接');
    const active = await tx.count(OrderSlot, { where: { orderId, status: Not('expired') } });
    if (active >= order.slotsTotal) throw new BadRequestException('名额已满');
    const mine = await tx.count(OrderSlot, { where: { orderId, creatorUserId: userId, status: NotIn(['expired', 'refunded']) } });
    if (mine > 0) throw new BadRequestException('你已在本单中');
    if (!order.feeEarned) { await this.ledger.transfer(tx, { from: { platform: 'escrow' }, to: { platform: 'income' }, amountMicro: order.feeMicro, kind: 'posting_fee', ref: { type: 'order', id: order.id } }); await tx.update(Order, order.id, { feeEarned: true }); await this.referral.onFeeEvent(tx, { userId: order.merchantUserId, feeMicro: order.feeMicro, feeKind: 'posting_fee' }); }
    return tx.save(OrderSlot, { orderId, creatorUserId: userId, status: 'reserved', acceptedAt: new Date(), deliverDeadlineAt: addHours(new Date(), 3) });
  });
}
```

- [ ] **Step 4: 跑测试确认通过**（并发测试必须全绿）。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 抢单防超卖、交付与 3h 超时"
```

### Task 13: 核验（纯函数检查 + 队列重试 + 人工降级 + 申诉）

**Files:**
- Create: `backend/src/verification/checks.ts`、`verification.service.ts`、`verification.controller.ts`
- Test: `backend/src/verification/checks.spec.ts` + `backend/test/verification.e2e-spec.ts`

**Interfaces:**
- Consumes: T4 `getTweet`；T5 `SchedulerService.register('delivery', …)`；T12 slots
- Produces：
  - `evaluateDelivery(tweet: XTweet, exp: {handle; requirements; type}): {ok: boolean; reasons: string[]}`
    - 作者：`tweet.author.handle` 与绑定 handle 小写相等，否则 `author_mismatch`
    - 长度：`text.length ≥ minChars`（默认 comment/quote = 11（即 >10 字符）、post = 1；`requirements.minChars` 覆盖），否则 `too_short`
    - 关键词/话题标签/@提及：逐个在 `text` 中出现（大小写不敏感），缺 → `missing:xxx`
    - 链接：要求的链接**子串**匹配（忽略尾部斜杠、大小写），缺 → `missing_link:xxx`
  - `verification.service`（job handler）：`getTweet(url)` → `evaluateDelivery` → 通过：`slot.status='passed'`、`confirmed_deadline_at = now+48h`、通知商家；不通过：`slot.status='reserved'`（回到可再交付，**不重新计时**）、`slot.last_reject={reasons,at}`、通知接单方
  - 失败语义：`XNotFoundError` → 按不通过处理（reason `tweet_not_found`，接单方可改链接再交——每次再交重新入队）；`XUpstreamError/XRateLimitError` → 抛给轮询器退避重试（`[1m,3m,10m,30m]`，超限 → job `manual`，名额停在 `verifying` 进人工队列）
  - 证据快照：每次核验（含复检）把拿到的推文 JSON 存 `slot.verify_snapshot`，争议时呈堂
  - 申诉：`POST /api/slots/:id/appeal`（JWT creator，`last_reject` 存在时）→ 通知 + 名额进人工待核标记（`appeal_requested=true`）
  - 人工处理位：`adminResolveDelivery(slotId, pass: boolean, adminId)`（HTTP 在 T17）：pass → 同「通过」路径；fail → 回到 `reserved`

- [ ] **Step 1: 写失败测试**

```ts
// checks.spec.ts（纯函数）
it('10 字符评论（==10）不过、11 字符过', ...);
it('关键词大小写不敏感：要求 "Alpha" / 正文含 "alpha" → 过', ...);
it('话题标签 #XWH 缺失 → reasons 含 missing:#XWH', ...);
it('链接忽略尾斜杠：要求 "x.com/a" / 正文 "x.com/a/" → 过', ...);
// e2e（mock scraper）
it('通过 → passed + 48h 确认窗 + 商家通知', ...);
it('打回 → 回 reserved、不重计时（deadline 不变）、通知带 reasons', ...);
it('限流 → 任务退避重试；4 次后 → manual，名额不动', ...);
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现** `checks.ts` 纯函数 + `verification.service` 的 job handler（含 `handle` 取接单方绑定 X 的 handle）。

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 交付核验、重试与人工降级"
```

### Task 14: 结算（商家确认 / 48h 自动放款 / 存活复检 / 订单到期）

**Files:**
- Create: `backend/src/settlement/settlement.service.ts`、`settlement.controller.ts`
- Test: `backend/test/settlement.e2e-spec.ts`

**Interfaces:**
- Consumes: T7 ledger；T4 `getTweet`；T5 jobs；T10 `onFeeEvent`；T11/T12
- Produces：
  - `POST /api/slots/:id/confirm`（JWT 商家）→ enqueue job `('payout', slotId)`（**幂等：同 slot 至多一个未完成 payout job**）
  - cron（60s）扫两条：
    1. `passed` 且 `confirmed_deadline_at <= now` 且无 open 争议 → enqueue `payout`
    2. `recruiting` 且 `expires_at <= now` → 订单到期关闭：退自由池 ×P；若 `fee_earned=false` 连 fee 全额退（该单从未被接）；`status='closed'`
  - `payout` job handler：**先存活复检** `getTweet(delivery_url)`——在事务外做；`XNotFoundError` → 名额标记 `manual`（进人工，通知商家可在 7 天内举报/或人工放行）；`XUpstreamError` → job 退避重试；存活 OK → 事务（锁 slot + order）：复核 `status='passed'`（防与争议竞态）→ `payout = P − fee_c`（`fee_c = pctFloor(P,5,100)`，零头给接单方）→ `transfer(escrow→creator, payout, 'slot_payout')` + `transfer(escrow→income, fee_c, 'completion_fee')` + `referral.onFeeEvent(fee_c)` → `slot.status='paid', settled_at=now`、`order.escrow_micro -= P`；若订单无任何未终态名额 → `order.status='completed'`
  - 终态口径：`paid / refunded / expired`（`expired` 名额在订单关闭时由退款覆盖）

- [ ] **Step 1: 写失败测试**

```ts
it('商家确认 → 接单方 95、income 5（P=100）、escrow 减 100、不变量保持', async () => {});
it('48h 到期无动作 → 自动放款（cron 触发）', async () => {});
it('商家先确认、cron 再到 → 只放一次（幂等）', async () => {});
it('存活复检：推已删 → 不进放款、名额进人工、商家收到通知', async () => {});
it('争议与自动放款竞态：事务锁内复核挡掉', async () => {});
it('订单到期：自由池退款；从未被接的订单全额退含 fee', async () => {});
it('全部名额终态 → order.completed', async () => {});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**（要点）

```ts
// payout job handler
async handlePayout(job) {
  const slot = await this.slots.get(job.refId);
  let tweet;
  try { tweet = await this.scraper.getTweet(slot.deliveryUrl); }
  catch (e) { if (e instanceof XNotFoundError) return this.settlement.toManual(slot, '存活复检失败：推文不可见'); throw e; } // Upstream → 轮询器退避
  await this.ds.transaction(async tx => {
    const s = await this.lockSlot(tx, slot.id);
    if (s.status !== 'passed') return;               // 与争议/人工裁决竞态时安全退出
    const fee = pctFloor(s.order.priceMicro, 5, 100);
    await this.ledger.transfer(tx, { from: { platform: 'escrow' }, to: { userId: s.creatorUserId }, amountMicro: s.order.priceMicro - fee, kind: 'slot_payout', ref: { type: 'slot', id: s.id } });
    await this.ledger.transfer(tx, { from: { platform: 'escrow' }, to: { platform: 'income' }, amountMicro: fee, kind: 'completion_fee', ref: { type: 'slot', id: s.id } });
    await this.referral.onFeeEvent(tx, { userId: s.order.merchantUserId, feeMicro: fee, feeKind: 'completion_fee' });
    await this.markPaidAndMaybeComplete(tx, s);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 结算、自动放款与存活复检"
```

### Task 15: 争议（商家申诉 / 人工裁决 / 删帖追回）

**Files:**
- Create: `backend/src/disputes/dispute.entity.ts`、`disputes.service.ts`、`disputes.controller.ts`
- Create: `backend/src/database/migrations/1700000009000-disputes.ts`
- Test: `backend/test/disputes.e2e-spec.ts`

**Interfaces:**
- Consumes: T7 ledger；T14 payout job 机制
- Produces：
  - `disputes` 表：`id, slot_id, order_id, raised_by('merchant'|'creator'), kind('quality'|'deletion'), statement, evidence jsonb[], status('open'|'resolved_payout'|'resolved_refund'|'resolved_clawback'), ruling text, resolved_by, resolved_at, arbiter_meta jsonb default '{}' /* 预留：仲裁者多人裁定 */, created_at`
  - `POST /api/slots/:id/dispute {statement}`（JWT 商家）：仅 `passed` 且确认窗内 → 名额 `disputed`（**自动放款被挡**：cron 只放 `passed`）+ 撤销该 slot 未执行的 payout job
  - `POST /api/slots/:id/report-deletion {statement}`（JWT 商家）：名额 `paid` 且 `settled_at` 在 7 天内 → 建 `kind='deletion'` 争议
  - `POST /api/disputes/:id/respond {statement}`（JWT 对方当事人）→ 追加 evidence
  - `DisputesService.resolve(id, ruling: 'payout'|'refund'|'clawback', adminId, note)`（HTTP 在 T17）：
    - `payout`：名额回 `passed` → enqueue payout job → `resolved_payout`
    - `refund`：事务 `transfer(escrow→merchant, P, 'order_refund')`、名额 `refunded`、订单终态复核 → `resolved_refund`
    - `clawback`：事务 `transfer(creator→merchant, min(P, creator.available), 'deletion_clawback')`；余额不足 → 部分追回 + `users.violations+1` + note 记差额 → `resolved_clawback`
  - 通知双方裁决结果

- [ ] **Step 1: 写失败测试**

```ts
it('确认窗内商家争议 → 名额 disputed；cron 跳过它', ...);
it('裁决 payout → 名额回 passed → 放款正常执行', ...);
it('裁决 refund → escrow 减 P、商家回款 P、名额 refunded', ...);
it('删帖追回：接单方余额够 → 全额 P 划回商家', ...);
it('删帖追回：余额不足 → 部分 + violations+1 + note', ...);
it('窗口外争议 → 400（passed 超 48h / paid 超 7 天）', ...);
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 争议流程与删帖追回"
```

### Task 16: 双向互评

**Files:**
- Create: `backend/src/reviews/review.entity.ts`、`reviews.service.ts`、`reviews.controller.ts`
- Create: `backend/src/database/migrations/1700000010000-reviews.ts`
- Test: `backend/test/reviews.e2e-spec.ts`

**Interfaces:**
- Consumes: T12 slots（`paid` 状态）
- Produces：
  - `reviews` 表：`id, slot_id, order_id, from_user_id, to_user_id, score int 1..5, comment text null, created_at`；唯一索引 `(slot_id, from_user_id)`
  - `POST /api/slots/:id/review {score, comment?}`（JWT，**仅 `paid` 名额**、仅当事人、每侧一次）；商家评接单方、接单方评商家
  - `GET /api/users/:id/rating`（公开）→ `{average: number|null, count, recent: Review[]}`（`AVG(score)` 实时算）
  - 通知被评方

- [ ] **Step 1: 写失败测试**

```ts
it('paid 后双方各能评一次；重复 → 409', ...);
it('未 paid 名额评分 → 400', ...);
it('average 计算正确（含一位小数）', ...);
it('非当事人 → 403', ...);
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 双向互评"
```

---

## Phase 4 · 后台与运营

### Task 17: Admin 登录/守卫、提现与充值审核、抽查、罚则执行

**Files:**
- Create: `backend/src/admin/admin.module.ts`、`admin.controller.ts`、`admin.service.ts`、`admin-auth.controller.ts`、`backend/src/common/guards/admin.guard.ts`
- Test: `backend/test/admin.e2e-spec.ts`

**Interfaces:**
- Consumes: T9 `WithdrawalsService.approve/markPaid/reject`；T8 `claimTo`；T13 `adminResolveDelivery`；T15 `DisputesService.resolve`；T7 `forfeitAll`
- Produces：
  - `POST /api/admin/login {address, password}` → JWT（payload 带 `role:'admin'`；用 T2 seed 的账号；bcrypt 校验；非 admin → 401）
  - `AdminGuard`：JWT + `role==='admin'`
  - 提现队列：`GET /api/admin/withdrawals?status=pending`（联用户、`isFirst`、`isNewAddress`=与该用户最近一次已打款地址不同（首提视为 true）、`flagged24h`=同用户近 24h 其他申请）；`POST /api/admin/withdrawals/:id/approve`；`POST /api/admin/withdrawals/:id/paid {txHash}`；`POST /api/admin/withdrawals/:id/reject {reason}`
  - 充值：`GET /api/admin/deposits?status=unmatched`；`POST /api/admin/deposits/:id/claim {userId}` → 人工入账（`credit` + `credited` + 记录 admin 操作）
  - 人工待核：`GET /api/admin/manual-queue`（聚合 `verification_jobs.status='manual'` + `slots.appeal_requested=true` + `slots` 存活复检失败标记）；`POST /api/admin/slots/:id/resolve-delivery {pass}`；`POST /api/admin/jobs/:id/retry`
  - 抽查：`GET /api/admin/orders?q=&type=&status=&page=`（搜标题/商家地址/单号）；`GET /api/admin/orders/:id`（全量：名额、交付链接、核验快照）
  - **罚则**：`POST /api/admin/orders/:id/penalize {reason}` → 事务/编排：
    1. 该单 `status='closed'`；其 escrow 全额 → income（`kind='forfeit'`）
    2. 接单方中**善意已交付**（slots 处于 `verifying/passed/disputed/paid` 之外但已交付过的…口径：`delivered_at != null` 即善意）由平台补发：`transfer(income→creator, P, memo='违规单补发')`，名额标 `refunded`
    3. 未交付的 `reserved` 名额直接 `expired`
    4. 商家 `forfeitAll` → income；`users.status='suspended'`
  - `POST /api/admin/users/:id/suspend`、`/unsuspend`（通用封号）；`GET /api/admin/users?q=`

- [ ] **Step 1: 写失败测试**

```ts
it('非 admin JWT 访问 /api/admin/* → 403', ...);
it('提现 paid → 走 T9 markPaid（冻结出账、状态 paid）', ...);
it('提现队列 isNewAddress：首提 true；与上次地址不同 true', ...);
it('罚则：escrow 全额没收、商家余额清零且 suspend、已交付名额平台按 P 补发', async () => {
  // 构造：商家1单（P=100×3 名额）：名额A已交付在 verifying、名额B reserved、无名额C；
  // 断言：income 增收 escrow 全额；creatorA 收 100 补发；B expired；商家 available=0 且 suspended
});
it('罚则不碰已 paid 的名额（钱已结给接单方）', ...);
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。
- [ ] **Step 3: 实现**（罚则编排逐条对照上面口径；每一步写 `admin_actions` 审计日志表：`id, admin_user_id, action, target_type, target_id, detail jsonb, created_at`）。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 管理后台基座、审核队列与罚则"
```

### Task 18: 对账巡检与告警

**Files:**
- Create: `backend/src/admin/reconciliation.service.ts`、controller 端点
- Modify: `backend/src/deposits/chain-provider.ts`（加 `getUsdtBalance(address): Promise<string /* wei */>`，BSC provider 用 `balanceOf` 实现，Fake 可注入）
- Test: `backend/test/reconciliation.e2e-spec.ts`

**Interfaces:**
- Consumes: T7 accounts/ledger；T8 provider；T9 pending withdrawals
- Produces：
  - `GET /api/admin/reconciliation` → `{totalXm, walletUsdtMicro, requiredMicro /* = pctFloor(totalXm,90,100) + Σpending payout_micro */, deficitMicro, status: 'ok'|'deficit', income: {postingFee, completionFee, withdrawalFee, forfeit, rebatePaid, net}, accounts: {escrowAvailable, platformIncome}}`
  - cron（每 30 分钟）+ 端点按需：`deficitMicro > 0` → 日志 + `ALERT_WEBHOOK_URL` POST `{text}`（fire-and-forget；无 URL 则跳过）
  - 口径（唯一版本）：`totalXm = Σ(所有账户 available+frozen)`（含用户、escrow、income——escrow 是要付出去/要退的钱，income 是平台已赚）；`requiredMicro = pctFloor(totalXm, 90, 100) + Σ(pending 提现的 payout_micro)`；`deficitMicro = max(0, requiredMicro − walletUsdtMicro)`

- [ ] **Step 1: 写失败测试**

```ts
it('健康状态：钱包按 fixture 充足 → status ok、deficit=0', ...);
it('deficit：钱包余额不足 → deficit 数值正确、webhook 被调用（mock fetch）', ...);
it('income 分项：发单费/完结费/提现费/没收/返佣支出净额汇总正确', ...);
```

- [ ] **Step 2-4: 常规 TDD 循环**（实现 → 全绿）。
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 对账巡检与告警"
```

### Task 19: 服务条款（版本化 + 注册强制同意）

**Files:**
- Create: `backend/src/terms/terms.entity.ts`、`user-consent.entity.ts`、`terms.service.ts`、`terms.controller.ts`
- Modify: `backend/src/auth/auth.service.ts`（`/auth/verify` 强制 `termsVersion === 最新版`，否则 400 `需同意最新服务条款`；同意则写 `user_consents`）
- Create: `backend/src/database/migrations/1700000011000-terms.ts`
- Test: `backend/test/terms.e2e-spec.ts`

**Interfaces:**
- Consumes: T3 auth；T2 users
- Produces：
  - `terms` 表：`id, version int unique, title, content_md text, published_at, is_current bool`；`user_consents(user_id, terms_version, agreed_at)` 唯一 `(user_id, terms_version)`
  - `GET /api/terms/current`（公开）→ `{version, title, content_md}`
  - `POST /api/admin/terms {title, contentMd}` → 发布新版本（version+1、旧版 `is_current=false`）
  - 注册同意：`/api/auth/verify` 入参加 `termsVersion?: number`；不等于最新版 → 400（前端在注册流展示条款）
  - 迁移里预置 v1 条款占位（标题「用户协议与免责声明」+ 运营者待替换的正文占位段落——**正文终稿由运营者定，内容里必须留「违规定义与处置（含没收不予退还）」章节标题**）

- [ ] **Step 1: 写失败测试**

```ts
it('不带 termsVersion 注册 → 400；带旧版本 → 400；带当前版本 → 成功且留 consent', ...);
it('发布 v2 后：v1 注册被拒、v2 通过', ...);
it('GET /api/terms/current 返回最新版', ...);
```

- [ ] **Step 2-4: 常规 TDD 循环**。
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 服务条款版本化与注册同意"
```

---

## Phase 5 · 用户前端（Next.js）

### Task 20: 前端基座、金额工具与登录/注册/绑定流

**Files:**
- Create: `frontend/package.json`（next@^14 react@^18 axios tailwindcss postcss autoprefixer qrcode.react + dev vitest）、`next.config.mjs`、`tailwind.config.ts`、`tsconfig.json`、`postcss.config.js`
- Create: `frontend/src/lib/api.ts`（axios：`baseURL=NEXT_PUBLIC_API_URL`、自动附 access token、401 时用 refresh 换一次并重放）、`src/lib/format.ts`、`src/lib/format.spec.ts`、`src/lib/wallet.ts`（window.ethereum 封装）
- Create: `frontend/src/app/layout.tsx`（全站中文框架 + 顶部导航：大厅 / 我的任务 / 钱包 / 邀请 / 登录态）、`src/app/login/page.tsx`、`src/app/me/page.tsx`
- Test: `src/lib/format.spec.ts`（vitest）

**Interfaces:**
- Consumes: T3/T5/T19 后端接口；`NEXT_PUBLIC_API_URL`（dev `http://localhost:4001/api`）
- Produces：
  - `format.ts`（前后端同口径的**展示用**运算）：`payoutOf(priceXm): string`（= P − floor(P×5%)，与后端 `pctFloor` 一致）、`feeOf(orderTotal, 5)`、`withdrawalPreview(amountXm): {fee, payout}`（10% floor）——纯函数，vitest 钉住与后端一致性样例
  - 登录流：连接钱包（`eth_requestAccounts`）→ `GET nonce` → `personal_sign` → `POST /auth/verify`（携带 `termsVersion` + 可选 `referralCode`[从 URL `?ref=` 预填]）；**手动签名兜底**：无法弹钱包时展示 message 文本框 + signature 粘贴框
  - 绑定流：handle 输入 → `POST /bindings/x/start` → 展示验证码与操作指引 → 每 5s 轮询 `GET /bindings/x/status` → active 后进首页

- [ ] **Step 1: 写失败测试** `format.spec.ts`

```ts
it('到手价：P=100 → "95"；P=33 → "31.35"（floor 到 micro 再展示）', ...);
it('提现预览：50 → {fee:"5", payout:"45"}；90 → {fee:"9", payout:"81"}', ...);
it('与后端口径一致样例：P=33.333333 → 手续 1.666666', ...);
```

- [ ] **Step 2: 跑测试确认失败** → `cd frontend && npm i && npx vitest run` FAIL。
- [ ] **Step 3: 实现** `format.ts` + 页面（登录三步骤 + 条款勾选展示 `GET /terms/current` 全文折叠）。
- [ ] **Step 4: 跑测试确认通过** + `npm run build` 通过；手动 QA：无钱包环境下用「手动签名」路径走完注册（用 MetaMask 导出私钥在测试钱包签也行）。
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(xwh): 前端基座与登录注册流"
```

### Task 21: 大厅与商单详情（含抢单）

**Files:**
- Create: `frontend/src/app/page.tsx`（大厅，服务端取数）、`src/app/orders/[id]/page.tsx`、`src/components/OrderCard.tsx`、`src/components/RatingBadge.tsx`、`src/components/TakeButton.tsx`（client）
- Test: `npm run build` + 手动 QA 清单（见步骤）

**Interfaces:**
- Consumes: T11 `GET /api/orders`、`GET /api/orders/:id`；T12 `POST /api/orders/:id/take`
- Produces：大厅卡（类型徽章 / 标题 / 单价 XM / **到手 XM** / 剩余名额 / 商家评级 / 关键词 chips / 招募截止）；筛选（type、按价格/最新）；分页；详情页含名额列表与抢单按钮（未登录 → 跳 `/login`；失败显示后端中文原因：名额已满 / 你已在本单中 / 该商单不可接）

- [ ] **Step 1: 手动 QA 清单先跑一遍（预期全红）**：① 未登录访问大厅可看单；② 点抢单跳登录；③ 登录后抢单成功名额-1；④ 抢满的单按钮禁用；⑤ 详情页刷新出现自己的 `reserved` 名额。
- [ ] **Step 2: 实现大厅与详情页**（服务端组件 fetch + TakeButton client 组件）。
- [ ] **Step 3: `npm run build` 通过 + QA 清单全绿**。
- [ ] **Step 4: Commit**

```bash
git commit -am "feat(xwh): 大厅、单详情与抢单"
```

### Task 22: 我的任务（双 Tab）与钱包页

**Files:**
- Create: `frontend/src/app/me/tasks/page.tsx`、`src/app/wallet/page.tsx`、`src/components/Countdown.tsx`、`src/components/Stars.tsx`、`src/lib/countdown.spec.ts`
- Modify（后端补两个只读端点，含测试）：`backend/src/ledger/ledger.controller.ts`（新增 `GET /api/ledger/mine` → 余额（可用/冻结）+ 近期流水）；`backend/src/slots/slots.controller.ts`（已有 `GET /api/me/slots` 的复用确认）
- Test: `countdown.spec.ts` + 后端新端点 e2e 一行用例 + 构建 + 手动 QA

**Interfaces:**
- Consumes: T12 `GET /api/me/slots`、`POST /api/slots/:id/deliver`、T13 申诉、T11 建单/下架、T14 `POST /api/slots/:id/confirm`、T15 争议/举报、T16 评价、T9 提现、T8 充值展示、T7 `GET /api/ledger/mine`
- Produces：
  - **接单 Tab**：名额列表（状态、3h 倒计时组件、交付表单、打回原因、申诉按钮、48h 确认倒计时、评价表单）
  - **发单 Tab**：建单表单（含 `requirements` 四类要求输入、comment/quote 显示目标推文输入）+ **实时费用预览**（预算合计 / 发单费 5% / 冻结合计，复用 `format.ts`）+ 单列表（名额进度、确认放款、争议、举报删帖（paid 7 天内）、下架）
  - **钱包页**：可用/冻结余额、充值面板（绑定地址 + 二维码（qrcode.react） + 「仅从绑定钱包转 BSC USDT(BEP20)，1:1 到账」 + 充值记录）、提现表单（客户端校验 ≥50 且整十 + 10% 预览 + 后端错误展示 + 记录列表）、流水列表
  - `countdown.ts`：纯函数 `formatRemaining(deadlineMs, nowMs): {text: '2:59:59'|'已超时', urgent: boolean}`

- [ ] **Step 1: 写失败测试** `countdown.spec.ts`：`3h` 剩 `2:59:59`；`<10min` urgent；负数 → 已超时。
- [ ] **Step 2: 实现**（倒计时、表单、预览）。
- [ ] **Step 3: 全绿 + build + 手动 QA**：① 抢单后倒计时走动；② 交付提交后出「核验中」；③ 发单预览数字与后端冻结一致；④ 提现 55 被前端拦、50 出预览、提交后冻结余额正确。
- [ ] **Step 4: Commit**

```bash
git commit -am "feat(xwh): 我的任务与钱包页"
```

### Task 23: 公开主页、OG 分享图、邀请页

**Files:**
- Create: `frontend/src/app/u/[id]/page.tsx`、`src/app/invite/page.tsx`、`src/app/api/og/order/[id]/route.tsx`、`src/app/api/og/u/[id]/route.tsx`（`next/og` ImageResponse）、`generateMetadata`（og:image 指向上面路由，绝对地址用 `NEXT_PUBLIC_SITE_URL`）
- Modify（后端补一个公开端点 + 测试）：`backend/src/users/users.controller.ts` 新增 `GET /api/users/:id/public` → `{handle, joined, ratingGrade, completedCount, xBound}`
- Test: build + 手动 QA（OG 路由直开成图、分享卡片挂在页面 metadata）

**Interfaces:**
- Consumes: T6 `GET /api/ratings/:handle`、T16 `GET /api/users/:id/rating`、T10 `GET /api/referral/mine`、新公开端点
- Produces：
  - 主页：昵称、评级徽章 + 分数明细、星级均分、完成单数、入驻时间、X 链接（绿标）、近期评价
  - 邀请页：我的邀请码 + 复制分享链接（`/login?ref=CODE`）、已邀人数、**距下一档还差几人**（20→30→40）、返佣累计
  - OG 图：单页图（类型/标题/单价/到手/剩余名额）、个人页图（评级 + 星级 + 完成数）

- [ ] **Step 1: 实现页面 + OG 路由 + 后端公开端点**。
- [ ] **Step 2: build + QA**：`/api/og/order/<id>` 直开返回 PNG；主页/邀请页数据正确；分享链接带 ref 打开登录页预填邀请码。
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(xwh): 公开主页、OG 分享与邀请页"
```

---

## Phase 6 · 后台前端与上线

### Task 24: 后台管理前端（运营者工位）

**Files:**
- Create: `frontend/src/app/admin/layout.tsx`（admin token 独立存储 + 未登录跳 `/admin/login`）、`admin/login/page.tsx`、`admin/withdrawals/page.tsx`、`admin/deposits/page.tsx`、`admin/manual/page.tsx`、`admin/disputes/page.tsx`、`admin/orders/page.tsx`、`admin/users/page.tsx`、`admin/reconciliation/page.tsx`、`admin/terms/page.tsx`
- Test: build + 手动 QA 清单

**Interfaces:**
- Consumes: T17/T18/T19 的全部 `/api/admin/*`
- Produces（每页一张表 + 行内动作，操作后写审计日志）：
  - 提现队列（**首要工位**）：待处理列表（用户/地址/金额/实付/首提/新地址标/24h 标记）→ 通过 / 已打款（填 txHash）/ 驳回（填理由）
  - 充值：未匹配列表 → 认领给用户（输入用户地址）
  - 人工待核：核验 manual + 申诉 + 存活失败 → 放行/驳回/重试
  - 争议：全文陈述与证据 → 裁决（payout / refund / clawback + 备注）
  - 抽查：订单搜索（关键词/商家/状态）→ 详情（交付链接、核验记录）→ **罚则按钮**（二次确认弹窗写原因）
  - 用户：搜索、封禁/解封、评级与违约记录查看
  - 对账：状态横幅（黄/红）、XM 总量、应付下限、钱包余额、deficit、收入分项
  - 条款：编辑 → 发布新版本（版本号自动 +1）

- [ ] **Step 1: 手动 QA 清单**（先跑，全红）：逐页对照上面动作列表点一遍（mock 数据）。
- [ ] **Step 2: 实现**。
- [ ] **Step 3: build + QA 全绿**。
- [ ] **Step 4: Commit**

```bash
git commit -am "feat(xwh): 后台管理前端"
```

### Task 25: Docker 化、部署文档与上线冒烟

**Files:**
- Create: `backend/Dockerfile`、`frontend/Dockerfile`、`docker-compose.prod.yml`、`deploy/Caddyfile`、`scripts/backup.sh`、`docs/deploy.md`
- Modify: `frontend/next.config.mjs`（`output:'standalone'`）
- Test: 本地 `docker compose -f docker-compose.prod.yml up --build` 冒烟

**Interfaces:**
- Consumes: 全部已完成；`.env.production`（由 `.env.example` 派生）
- Produces：
  - `backend/Dockerfile`：`node:20-bookworm-slim` + `apt-get install -y python3`；构建含 dev 依赖编译（`npm ci && npm run build`）；**镜像内带 `tools/x.py`**；env `XSCRAPER_PYTHON=python3 XSCRAPER_SCRIPT=/app/tools/x.py`；CMD `node dist/main`。**服务器不存任何钱包私钥**——打款由运营者用自己钱包手动完成，平台只存收款地址（只读）
  - `frontend/Dockerfile`：多阶段 standalone 产物
  - `docker-compose.prod.yml`：postgres / redis / api / web / caddy（80/443 自动 TLS）；healthcheck；`restart: unless-stopped`；pgdata 卷
  - `deploy/Caddyfile`：`{$DOMAIN}` → `/api/*` 反代 `api:4001`，其余反代 `web:4000`
  - **生产迁移命令**（构建后走编译产物）：`docker compose -f docker-compose.prod.yml exec api node ./node_modules/typeorm/cli.js migration:run -d dist/config/database.config.js`
  - `scripts/backup.sh`：`pg_dump` 每日 + 保留 14 份（部署文档说明挂 cron）
  - `docs/deploy.md`：VPS 步骤（env 填写清单：JWT 双密钥、`PLATFORM_WALLET_ADDRESS`、建议付费私有 `BSC_RPC_URL`、`ALERT_WEBHOOK_URL`（TG bot）；DNS；起服；迁移；seed admin；条款 v1 正文替换教程）+
    **上线冒烟清单（真钱小额）**：注册→绑 X→充 11 USDT（测自动匹配）→发单（1 名额）→自抢→交付→核验→商家确认→放款→提现 50（人工全流程）→对账页 status ok

- [ ] **Step 1: 写 Dockerfile / compose / Caddyfile / backup / deploy.md**。
- [ ] **Step 2: 本地冒烟**：`docker compose -f docker-compose.prod.yml up --build -d`；`curl localhost/api/health`（Caddy 内）→ `{status:'ok'}`；浏览器开 `http://localhost` 见大厅。
- [ ] **Step 3: 冒烟清单在本地 staging 全链路走一遍**（除真实充值可以用 FakeChainProvider 手动触发）。
- [ ] **Step 4: Commit**

```bash
git commit -am "feat(xwh): Docker 化、部署文档与冒烟"
```

---

## 里程碑与执行注记

**里程碑序列**（每阶段收尾跑全量 `npm test` + `npm run test:e2e`）：

1. **M0 基座**（T1-2）：本地起服务 + 库迁移通
2. **M1 账号**（T3-6）：可以注册（签名）、绑 X、出评级
3. **M2 资金**（T7-10）：充值自动到账、提现走人工队列、返佣生效
4. **M3 商单闭环**（T11-16）：建单→抢→交付→核验→放款→争议→互评，全链路测试绿
5. **M4 后台**（T17-19）：运营者可以审提现、执行罚则、看对账
6. **M5 前端**（T20-23）：用户侧可用（大厅/任务/钱包/主页/邀请）
7. **M6 上线**（T24-25）：后台前端 + 部署 + 真钱小额冒烟

**执行注记**：

- 每个任务开工前：`docker compose up -d postgres`；e2e 用 `.env.test`（`DB_DATABASE=xwh_test`），首次需 `CREATE DATABASE xwh_test`。
- `test/network/` 下的联网测试默认跳过（本机还需配 `HTTPS_PROXY` 的 **HTTP** 代理，x.py 不支持 socks）；部署后在 VPS 上跑。
- **金额纪律**：任何地方不得用 JS `number` 做金额算术（只用 `bigint` + 十进制字符串）；任何动账改动提交前必须复跑 T7 守恒测试与 T18 对账测试。
- 提交粒度：每任务一次提交（步骤里已内置），沿用你直接在 Desktop 仓 main 上提交的习惯。
- 本计划刻意不引入：消息队列（用 DB jobs 表）、WebSocket、微服务、K8s——1.0 单进程 + cron 轮询足够，符合 YAGNI。
- 与 spec 的实施差异（有意为之）：核验 worker 1.0 跑在 API 进程内（DB jobs 表 + cron 轮询，单实例无并发问题）；将来要拆独立进程，把 `jobs` 轮询器单独起一个 Nest 应用即可，队列语义不变。
