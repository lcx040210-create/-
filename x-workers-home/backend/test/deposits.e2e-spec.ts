import {
  BadRequestException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { BscWatcherService } from '../src/deposits/bsc-watcher.service';
import { ChainCursor } from '../src/deposits/chain-cursor.entity';
import {
  CHAIN_PROVIDER,
  ChainProvider,
  ChainTransfer,
  GetUsdtTransfersParams,
} from '../src/deposits/chain-provider';
import { Deposit } from '../src/deposits/deposit.entity';
import { DepositsService } from '../src/deposits/deposits.service';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { User } from '../src/users/user.entity';

/** 平台收款地址（watcher 查询时统一小写） */
function platformWallet(): string {
  return (process.env.PLATFORM_WALLET_ADDRESS || '').toLowerCase();
}

class FakeChainProvider implements ChainProvider {
  latestBlock = 0;
  transfers: ChainTransfer[] = [];
  latestError: Error | null = null;
  transfersError: Error | null = null;
  queries: GetUsdtTransfersParams[] = [];

  async getLatestBlock(): Promise<number> {
    if (this.latestError) throw this.latestError;
    return this.latestBlock;
  }

  async getUsdtBalance(_address: string): Promise<string> {
    return '0';
  }

  async getUsdtTransfers(p: GetUsdtTransfersParams): Promise<ChainTransfer[]> {
    this.queries.push({ ...p });
    if (this.transfersError) throw this.transfersError;
    return this.transfers.filter(
      (t) =>
        t.blockNumber >= p.fromBlock &&
        t.blockNumber <= p.toBlock &&
        t.to.toLowerCase() === p.to.toLowerCase(),
    );
  }

  reset(latestBlock = 0): void {
    this.latestBlock = latestBlock;
    this.transfers = [];
    this.latestError = null;
    this.transfersError = null;
    this.queries = [];
  }
}

const fakeChain = new FakeChainProvider();

describe('BSC 充值监听 e2e（FakeChainProvider）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let watcher: BscWatcherService;
  let depositsService: DepositsService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];
  const usedTxHashes: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(address: string = randomAddress()): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: address.toLowerCase(),
        status: 'active',
        role: 'user',
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  function makeTransfer(overrides: Partial<ChainTransfer> = {}): ChainTransfer {
    const txHash = overrides.txHash ?? `0x${randomUUID().replace(/-/g, '')}`;
    usedTxHashes.push(txHash);
    return {
      logIndex: 0,
      from: randomAddress(),
      to: platformWallet(),
      amountWei: '100500000000000000000',
      blockNumber: 900,
      ...overrides,
      txHash,
    };
  }

  async function accountOf(userId: string): Promise<Account | null> {
    return ds.getRepository(Account).findOne({ where: { ownerUserId: userId } });
  }

  async function balanceOf(userId: string): Promise<bigint> {
    return (await accountOf(userId))?.available ?? 0n;
  }

  async function sumAll(): Promise<bigint> {
    const rows = await ds.query(
      `SELECT COALESCE(SUM("available" + "frozen"), 0)::text AS total FROM "accounts"`,
    );
    return BigInt(rows[0].total);
  }

  async function cursorBlock(): Promise<bigint> {
    const row = await ds.getRepository(ChainCursor).findOne({ where: { id: 'bsc' } });
    return row?.lastBlock ?? 0n;
  }

  async function depositOf(txHash: string): Promise<Deposit | null> {
    return ds.getRepository(Deposit).findOne({ where: { txHash } });
  }

  async function entriesOf(depositId: string): Promise<LedgerEntry[]> {
    return ds.getRepository(LedgerEntry).find({
      where: { refType: 'deposit', refId: depositId },
    });
  }

  async function signToken(user: User): Promise<string> {
    return jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: process.env.JWT_SECRET, expiresIn: '1h' },
    );
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
    watcher = app.get(BscWatcherService);
    depositsService = app.get(DepositsService);
    jwt = app.get(JwtService);
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM "deposits"`);
    await ds.query(
      `INSERT INTO "chain_cursors" ("id", "last_block") VALUES ('bsc', 0)
       ON CONFLICT ("id") DO UPDATE SET "last_block" = 0`,
    );
    fakeChain.reset();
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (createdUserIds.length) {
        const accounts = await ds
          .getRepository(Account)
          .find({ where: { ownerUserId: In(createdUserIds) } });
        if (accounts.length) {
          await ds
            .getRepository(LedgerEntry)
            .delete({ accountId: In(accounts.map((a) => a.id)) });
        }
      }
      if (usedTxHashes.length) {
        await ds.getRepository(Deposit).delete({ txHash: In(usedTxHashes) });
      }
      if (createdUserIds.length) {
        await ds.getRepository(Account).delete({ ownerUserId: In(createdUserIds) });
        await ds.getRepository(User).delete({ id: In(createdUserIds) });
      }
      await ds.query(`UPDATE "chain_cursors" SET "last_block" = 0 WHERE "id" = 'bsc'`);
    }
    await app.close();
  });

  it('绑定钱包转入 100.5 USDT → 自动入账 100.5 XM，deposit.credited', async () => {
    const user = await makeUser();
    // 链上 from 可能是大小写混合，匹配键是 users.address（全小写）
    const transfer = makeTransfer({
      from: `0x${user.address.slice(2).toUpperCase()}`,
      logIndex: 7,
      amountWei: '100500000000000000000',
      blockNumber: 970,
    });
    fakeChain.latestBlock = 1000;
    fakeChain.transfers = [transfer];

    await watcher.tick();

    // safe = 1000 − 15 = 985，查询区间 (0, 985]
    expect(fakeChain.queries).toEqual([
      { to: platformWallet(), fromBlock: 1, toBlock: 985 },
    ]);
    expect(await cursorBlock()).toBe(985n);

    expect(await balanceOf(user.id)).toBe(100_500_000n);
    const deposit = await depositOf(transfer.txHash);
    expect(deposit).toMatchObject({
      txHash: transfer.txHash,
      logIndex: 7,
      fromAddress: user.address,
      toAddress: platformWallet(),
      rawAmountWei: '100500000000000000000',
      amountMicro: 100_500_000n,
      userId: user.id,
      status: 'credited',
      blockNumber: 970n,
    });

    const entries = await entriesOf(deposit!.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: user.id,
      kind: 'deposit_credit',
      refType: 'deposit',
      refId: deposit!.id,
      availableDelta: 100_500_000n,
      frozenDelta: 0n,
      availableAfter: 100_500_000n,
    });
  });

  it('陌生地址转入 → unmatched，不入账', async () => {
    const totalBefore = await sumAll();
    const transfer = makeTransfer({
      from: randomAddress(),
      amountWei: '42000000000000000000',
      blockNumber: 960,
    });
    fakeChain.latestBlock = 1000;
    fakeChain.transfers = [transfer];

    await watcher.tick();

    const deposit = await depositOf(transfer.txHash);
    expect(deposit).toMatchObject({
      userId: null,
      status: 'unmatched',
      amountMicro: 42_000_000n,
      fromAddress: transfer.from.toLowerCase(),
    });
    expect(await entriesOf(deposit!.id)).toHaveLength(0);
    // 系统总额不变（没有凭空入账），也没有为陌生地址建账户
    expect(await sumAll()).toBe(totalBefore);
    expect(await cursorBlock()).toBe(985n);
  });

  it('同一 log 二次 tick 重放 → 幂等（不重复入账）', async () => {
    const user = await makeUser();
    const transfer = makeTransfer({
      from: user.address,
      amountWei: '12500000000000000000',
      blockNumber: 950,
    });
    fakeChain.latestBlock = 1000;
    fakeChain.transfers = [transfer];

    await watcher.tick();
    expect(await balanceOf(user.id)).toBe(12_500_000n);

    // 回拨 cursor 强制重放同一区间（模拟进程重启 / 游标回退）
    await ds.query(`UPDATE "chain_cursors" SET "last_block" = 0 WHERE "id" = 'bsc'`);
    await watcher.tick();

    const deposits = await ds.getRepository(Deposit).find({ where: { txHash: transfer.txHash } });
    expect(deposits).toHaveLength(1);
    const entries = await entriesOf(deposits[0].id);
    expect(entries).toHaveLength(1);
    expect(await balanceOf(user.id)).toBe(12_500_000n);
    expect(await cursorBlock()).toBe(985n);
  });

  it('latest 块上的转账在 15 确认前不处理', async () => {
    const user = await makeUser();
    const transfer = makeTransfer({
      from: user.address,
      amountWei: '30000000000000000000',
      blockNumber: 1000,
    });
    fakeChain.latestBlock = 1000;
    fakeChain.transfers = [transfer];

    await watcher.tick();

    expect(await depositOf(transfer.txHash)).toBeNull();
    expect(await balanceOf(user.id)).toBe(0n);
    expect(await cursorBlock()).toBe(985n);

    // 链继续前进 15 块：latest − 15 = 1000，恰好进入确认区间 (985, 1000]
    fakeChain.latestBlock = 1015;
    await watcher.tick();

    expect(await balanceOf(user.id)).toBe(30_000_000n);
    expect(await depositOf(transfer.txHash)).toMatchObject({ status: 'credited' });
    expect(await cursorBlock()).toBe(1000n);
    expect(fakeChain.queries[1]).toEqual({
      to: platformWallet(),
      fromBlock: 986,
      toBlock: 1000,
    });
  });

  it('provider 抛错 → tick 不崩、cursor 不前进', async () => {
    const user = await makeUser();
    fakeChain.latestBlock = 1000;
    fakeChain.transfers = [makeTransfer({ from: user.address, blockNumber: 900 })];

    fakeChain.latestError = new Error('rpc down');
    await expect(watcher.tick()).resolves.toBeUndefined();
    expect(await cursorBlock()).toBe(0n);

    fakeChain.latestError = null;
    fakeChain.transfersError = new Error('getLogs failed');
    await expect(watcher.tick()).resolves.toBeUndefined();
    expect(await cursorBlock()).toBe(0n);
    expect(await ds.getRepository(Deposit).count()).toBe(0);
    expect(await balanceOf(user.id)).toBe(0n);

    // 恢复后继续推进
    fakeChain.transfersError = null;
    await watcher.tick();
    expect(await cursorBlock()).toBe(985n);
    expect(await balanceOf(user.id)).toBe(100_500_000n);
  });

  it('claimTo 把 unmatched 认领给用户并只入账一次（T17 人工入账）', async () => {
    const user = await makeUser();
    const transfer = makeTransfer({
      from: randomAddress(),
      amountWei: '2500000000000000000',
      blockNumber: 940,
    });
    fakeChain.latestBlock = 1000;
    fakeChain.transfers = [transfer];
    await watcher.tick();

    const deposit = await depositOf(transfer.txHash);
    expect(deposit).toMatchObject({ status: 'unmatched', userId: null });

    const view = await depositsService.claimTo(deposit!.id, user.id);
    expect(view).toMatchObject({ status: 'credited', amount: '2.5', userId: user.id });
    expect(await balanceOf(user.id)).toBe(2_500_000n);
    expect(await depositOf(transfer.txHash)).toMatchObject({
      status: 'credited',
      userId: user.id,
    });
    expect(await entriesOf(deposit!.id)).toHaveLength(1);

    // 重复认领拒绝且不再入账
    await expect(depositsService.claimTo(deposit!.id, user.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await balanceOf(user.id)).toBe(2_500_000n);
    expect(await entriesOf(deposit!.id)).toHaveLength(1);

    // 不存在的充值记录
    await expect(depositsService.claimTo(randomUUID(), user.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('GET /api/deposits/mine 仅返回本人记录（新块在前），未登录 401', async () => {
    const user = await makeUser();
    const other = await makeUser();
    fakeChain.latestBlock = 1000;
    fakeChain.transfers = [
      makeTransfer({ from: user.address, amountWei: '10250000000000000000', blockNumber: 950, logIndex: 1 }),
      makeTransfer({ from: user.address, amountWei: '5000000000000000000', blockNumber: 960, logIndex: 2 }),
      makeTransfer({ from: other.address, amountWei: '7000000000000000000', blockNumber: 955, logIndex: 3 }),
    ];

    await watcher.tick();

    await request(server()).get('/api/deposits/mine').expect(401);

    const token = await signToken(user);
    const res = await request(server())
      .get('/api/deposits/mine')
      .set(auth(token))
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((d: any) => d.amount)).toEqual(['5', '10.25']);
    expect(res.body.map((d: any) => d.status)).toEqual(['credited', 'credited']);
    expect(res.body[0]).toMatchObject({
      txHash: fakeChain.transfers[1].txHash,
      logIndex: 2,
      amountMicro: '5000000',
      blockNumber: 960,
    });
    expect(typeof res.body[0].createdAt).toBe('string');
  });
});
