import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MICRO, formatXm, pctFloor } from '../src/common/money';
import { PLATFORM_ACCOUNTS } from '../src/database/migrations/1700000003000-ledger';
import {
  CHAIN_PROVIDER,
  ChainProvider,
  ChainTransfer,
  GetUsdtTransfersParams,
} from '../src/deposits/chain-provider';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import {
  AccountRef,
  LedgerKind,
  LedgerRef,
  LedgerService,
} from '../src/ledger/ledger.service';
import { User } from '../src/users/user.entity';
import { Withdrawal } from '../src/withdrawals/withdrawal.entity';

jest.setTimeout(30_000);

const XM = MICRO;
const ALERT_URL = 'https://alerts.example.test/xwh';

/** 只实现对账所需的最小链上接口；余额可注入。 */
class FakeChainProvider implements ChainProvider {
  usdtBalanceWei = '0';
  balanceQueries: string[] = [];

  async getLatestBlock(): Promise<number> {
    return 0;
  }

  async getUsdtTransfers(_p: GetUsdtTransfersParams): Promise<ChainTransfer[]> {
    return [];
  }

  async getUsdtBalance(address: string): Promise<string> {
    this.balanceQueries.push(address);
    return this.usdtBalanceWei;
  }
}

const fakeChain = new FakeChainProvider();

describe('对账巡检与告警 e2e（GET /api/admin/reconciliation）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let jwt: JwtService;

  let admin: User;
  let adminToken: string;

  const createdUserIds: string[] = [];
  const createdRefIds: string[] = [];
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(role: 'user' | 'admin' = 'user'): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress(),
        status: 'active',
        role,
        passwordHash: null,
        nickname: null,
        ratingGrade: null,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function signToken(user: User): Promise<string> {
    return jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: process.env.JWT_SECRET, expiresIn: '1h' },
    );
  }

  async function credit(userId: string, amountMicro: bigint): Promise<void> {
    const refId = randomUUID();
    createdRefIds.push(refId);
    await ds.transaction((tx) =>
      ledger.credit(tx, {
        userId,
        amountMicro,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: refId },
      }),
    );
  }

  async function transfer(
    from: AccountRef,
    to: AccountRef,
    amountMicro: bigint,
    kind: LedgerKind,
    refType: LedgerRef['type'] = 'order',
  ): Promise<void> {
    const refId = randomUUID();
    createdRefIds.push(refId);
    await ds.transaction((tx) =>
      ledger.transfer(tx, { from, to, amountMicro, kind, ref: { type: refType, id: refId } }),
    );
  }

  async function incomeByKind(): Promise<Record<string, bigint>> {
    const rows: Array<{ kind: string; delta: string }> = await ds.query(
      `SELECT "kind", COALESCE(SUM("available_delta" + "frozen_delta"), 0)::text AS "delta"
         FROM "ledger_entries"
        WHERE "account_id" = $1
        GROUP BY "kind"`,
      [PLATFORM_ACCOUNTS.income],
    );
    return Object.fromEntries(rows.map((row) => [row.kind, BigInt(row.delta)]));
  }

  interface Snapshot {
    totalMicro: bigint;
    pendingPayoutMicro: bigint;
    income: Record<string, bigint>;
  }

  async function snapshot(): Promise<Snapshot> {
    const [totalRow] = await ds.query(
      `SELECT COALESCE(SUM("available" + "frozen"), 0)::text AS "total" FROM "accounts"`,
    );
    const [pendingRow] = await ds.query(
      `SELECT COALESCE(SUM("payout_micro"), 0)::text AS "total"
         FROM "withdrawals" WHERE "status" IN ('pending', 'approved')`,
    );
    return {
      totalMicro: BigInt(totalRow.total),
      pendingPayoutMicro: BigInt(pendingRow.total),
      income: await incomeByKind(),
    };
  }

  function requiredOf(totalMicro: bigint, pendingPayoutMicro: bigint): bigint {
    return pctFloor(totalMicro, 90, 100) + pendingPayoutMicro;
  }

  /** micro-XM → 18 位 wei 整数字符串（USDT/BEP20 精度 18）。 */
  function walletWeiFromMicro(micro: bigint): string {
    return (micro * 10n ** 12n).toString();
  }

  async function platformBalance(id: string): Promise<bigint> {
    const account = await ds.getRepository(Account).findOneOrFail({ where: { id } });
    return account.available;
  }

  function incomeValue(map: Record<string, bigint>, kind: string): bigint {
    return map[kind] ?? 0n;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAIN_PROVIDER)
      .useValue(fakeChain)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    ledger = app.get(LedgerService);
    jwt = app.get(JwtService);

    admin = await makeUser('admin');
    adminToken = await signToken(admin);
  });

  beforeEach(() => {
    delete process.env.ALERT_WEBHOOK_URL;
    fakeChain.usdtBalanceWei = '0';
    fakeChain.balanceQueries = [];
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete process.env.ALERT_WEBHOOK_URL;
    (globalThis as any).fetch = originalFetch;
  });

  afterAll(async () => {
    try {
      if (ds?.isInitialized) {
        if (createdUserIds.length) {
          await ds.query(`DELETE FROM "withdrawals" WHERE "user_id" = ANY($1::uuid[])`, [
            createdUserIds,
          ]);
          const accounts = await ds
            .getRepository(Account)
            .find({ where: { ownerUserId: In(createdUserIds) } });
          if (accounts.length) {
            await ds
              .getRepository(LedgerEntry)
              .delete({ accountId: In(accounts.map((account) => account.id)) });
          }
          await ds.getRepository(Account).delete({ ownerUserId: In(createdUserIds) });
          await ds.getRepository(User).delete({ id: In(createdUserIds) });
        }
        // 平台账户行（transfer 的另一半）按 ref_id 清理，避免污染后续测试套件。
        if (createdRefIds.length) {
          await ds.query(`DELETE FROM "ledger_entries" WHERE "ref_id" = ANY($1::uuid[])`, [
            createdRefIds,
          ]);
        }
      }
    } finally {
      await app?.close();
    }
  });

  it('健康状态：钱包充足 → status ok、deficit 0、收入分项（含提现费/返佣/补发）与 net 正确', async () => {
    const base = await snapshot();

    const u1 = await makeUser();
    const u2 = await makeUser();
    // 充值只增加用户账户（deposit_credit 单边）；后续 transfer 总额守恒。
    await credit(u1.id, 100n * XM);

    // 种子：给 income 足够余额以便后续支出（返佣/补发）。
    await transfer({ userId: u1.id }, { platform: 'income' }, 10n * XM, 'posting_fee');
    // 发单费 +1
    await transfer({ userId: u1.id }, { platform: 'income' }, 1n * XM, 'posting_fee');
    // 托管后完结费 +2（escrow → income）
    await transfer({ userId: u1.id }, { platform: 'escrow' }, 5n * XM, 'order_freeze');
    await transfer({ platform: 'escrow' }, { platform: 'income' }, 2n * XM, 'completion_fee');
    // 提现费 +0.5
    await transfer({ userId: u1.id }, { platform: 'income' }, 500_000n, 'withdrawal_fee');
    // 没收 +0.25
    await transfer({ userId: u1.id }, { platform: 'income' }, 250_000n, 'forfeit');
    // 返佣支出 0.1（income → 邀请人）
    await transfer({ platform: 'income' }, { userId: u2.id }, 100_000n, 'referral_rebate', 'user');
    // 违规补发支出 0.2（income → 用户）
    await transfer(
      { platform: 'income' },
      { userId: u2.id },
      200_000n,
      'penalty_compensation',
      'order',
    );

    const after = await snapshot();
    const expectedRequired = requiredOf(after.totalMicro, after.pendingPayoutMicro);
    const walletMicro = expectedRequired + 5n * XM;
    fakeChain.usdtBalanceWei = walletWeiFromMicro(walletMicro);

    const res = await request(server())
      .get('/api/admin/reconciliation')
      .set(auth(adminToken))
      .expect(200);

    expect(fakeChain.balanceQueries).toEqual([
      (process.env.PLATFORM_WALLET_ADDRESS || '').toLowerCase(),
    ]);

    // 总量 / 应付 / 钱包 / deficit
    expect(res.body.totalXm).toBe(formatXm(after.totalMicro));
    expect(res.body.walletUsdtMicro).toBe(String(walletMicro));
    expect(res.body.requiredMicro).toBe(String(expectedRequired));
    expect(res.body.deficitMicro).toBe('0');
    expect(res.body.status).toBe('ok');

    // 收入分项：按 platform_income 账户流水净额累加（支出项以正数展示，net 中扣减）。
    const postingFee = incomeValue(after.income, 'posting_fee');
    const completionFee = incomeValue(after.income, 'completion_fee');
    const withdrawalFee = incomeValue(after.income, 'withdrawal_fee');
    const forfeit = incomeValue(after.income, 'forfeit');
    const rebateRaw = incomeValue(after.income, 'referral_rebate');
    const compensationRaw = incomeValue(after.income, 'penalty_compensation');

    expect(res.body.income).toEqual({
      postingFee: postingFee.toString(),
      completionFee: completionFee.toString(),
      withdrawalFee: withdrawalFee.toString(),
      forfeit: forfeit.toString(),
      rebatePaid: (-rebateRaw).toString(),
      compensationPaid: (-compensationRaw).toString(),
      net: (
        postingFee +
        completionFee +
        withdrawalFee +
        forfeit +
        rebateRaw +
        compensationRaw
      ).toString(),
    });

    // 本测试造出的分项增量（排除历史残留）。
    expect(postingFee - incomeValue(base.income, 'posting_fee')).toBe(11n * XM);
    expect(completionFee - incomeValue(base.income, 'completion_fee')).toBe(2n * XM);
    expect(withdrawalFee - incomeValue(base.income, 'withdrawal_fee')).toBe(500_000n);
    expect(forfeit - incomeValue(base.income, 'forfeit')).toBe(250_000n);
    expect(incomeValue(base.income, 'referral_rebate') - rebateRaw).toBe(100_000n);
    expect(incomeValue(base.income, 'penalty_compensation') - compensationRaw).toBe(200_000n);

    // 平台账户余额快照。
    expect(res.body.accounts).toEqual({
      escrowAvailable: (await platformBalance(PLATFORM_ACCOUNTS.escrow)).toString(),
      platformIncome: (await platformBalance(PLATFORM_ACCOUNTS.income)).toString(),
    });
    // 分项支出不产生重复计数：net = 平台收入账户全部 kind 汇总之和。
    const allKindsNet = Object.values(after.income).reduce((sum, value) => sum + value, 0n);
    expect(res.body.income.net).toBe(allKindsNet.toString());

    // 钱包充足 → 不告警
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deficit：钱包余额不足 → deficit 数值正确、webhook 被调用（fire-and-forget）', async () => {
    const u = await makeUser();
    await credit(u.id, 100n * XM);

    const after = await snapshot();
    const required = requiredOf(after.totalMicro, after.pendingPayoutMicro);
    const deficit = 7n * XM;
    const walletMicro = required - deficit;
    fakeChain.usdtBalanceWei = walletWeiFromMicro(walletMicro);
    process.env.ALERT_WEBHOOK_URL = ALERT_URL;

    const res = await request(server())
      .get('/api/admin/reconciliation')
      .set(auth(adminToken))
      .expect(200);

    expect(res.body.status).toBe('deficit');
    expect(res.body.requiredMicro).toBe(String(required));
    expect(res.body.walletUsdtMicro).toBe(String(walletMicro));
    expect(res.body.deficitMicro).toBe(String(deficit));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ALERT_URL);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const payload = JSON.parse(init.body as string);
    expect(payload.text).toEqual(expect.stringContaining('deficit'));
    expect(payload.text).toEqual(expect.stringContaining(formatXm(deficit)));
  });

  it('required 含 pending/approved 提现的 payout_micro', async () => {
    const u = await makeUser();
    const repo = ds.getRepository(Withdrawal);
    await repo.save([
      repo.create({
        userId: u.id,
        address: randomAddress(),
        amountMicro: 3_300_000n,
        feeMicro: 300_000n,
        payoutMicro: 3_000_000n,
        status: 'pending',
      }),
      repo.create({
        userId: u.id,
        address: randomAddress(),
        amountMicro: 2_200_000n,
        feeMicro: 200_000n,
        payoutMicro: 2_000_000n,
        status: 'approved',
      }),
    ]);

    const base = await snapshot();
    expect(base.pendingPayoutMicro).toBeGreaterThanOrEqual(5n * XM);

    const required = requiredOf(base.totalMicro, base.pendingPayoutMicro);
    fakeChain.usdtBalanceWei = walletWeiFromMicro(required);

    const res = await request(server())
      .get('/api/admin/reconciliation')
      .set(auth(adminToken))
      .expect(200);

    expect(res.body.requiredMicro).toBe(String(required));
    // 应付下限 = 90% 总量 + 待付 payout（提现费不另计，已含在 amount 冻结中）。
    expect(res.body.requiredMicro).toBe(
      String(pctFloor(base.totalMicro, 90, 100) + base.pendingPayoutMicro),
    );
    expect(res.body.status).toBe('ok');
  });

  it('未配置 ALERT_WEBHOOK_URL → deficit 时不调用、不报错', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const u = await makeUser();
    await credit(u.id, 10n * XM);

    const after = await snapshot();
    const required = requiredOf(after.totalMicro, after.pendingPayoutMicro);
    fakeChain.usdtBalanceWei = walletWeiFromMicro(required > 1n * XM ? required - 1n * XM : 0n);

    const res = await request(server())
      .get('/api/admin/reconciliation')
      .set(auth(adminToken))
      .expect(200);

    expect(res.body.status).toBe('deficit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非 admin 访问 → 403；未登录 → 401', async () => {
    const normal = await makeUser();
    const token = await signToken(normal);

    await request(server())
      .get('/api/admin/reconciliation')
      .set(auth(token))
      .expect(403);

    await request(server()).get('/api/admin/reconciliation').expect(401);
  });
});
