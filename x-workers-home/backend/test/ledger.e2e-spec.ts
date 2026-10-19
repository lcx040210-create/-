import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { InsufficientFundsError } from '../src/common/errors';
import { MICRO } from '../src/common/money';
import { PLATFORM_ACCOUNTS } from '../src/database/migrations/1700000003000-ledger';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { User } from '../src/users/user.entity';

const XM = MICRO;

describe('账本核心 e2e（accounts / ledger_entries / 资金原语）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;

  const createdUserIds: string[] = [];
  const createdAddresses: string[] = [];

  /** 真库全账户总额：Σ(available + frozen)，用 SQL 计算避免 JS number */
  async function sumAll(q: EntityManager | DataSource = ds): Promise<bigint> {
    const rows = await q.query(
      `SELECT COALESCE(SUM("available" + "frozen"), 0)::text AS total FROM "accounts"`,
    );
    return BigInt(rows[0].total);
  }

  async function makeUser(): Promise<string> {
    const address = `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({ address, status: 'active', role: 'user' }),
    );
    createdUserIds.push(user.id);
    createdAddresses.push(address);
    return user.id;
  }

  async function accountOf(userId: string): Promise<Account> {
    return ds.getRepository(Account).findOneOrFail({ where: { ownerUserId: userId } });
  }

  async function balancesOf(userId: string): Promise<{ available: bigint; frozen: bigint }> {
    const account = await accountOf(userId);
    return { available: account.available, frozen: account.frozen };
  }

  async function platformBalance(
    which: 'escrow' | 'income',
  ): Promise<{ available: bigint; frozen: bigint }> {
    const account = await ds
      .getRepository(Account)
      .findOneOrFail({ where: { id: PLATFORM_ACCOUNTS[which] } });
    return { available: account.available, frozen: account.frozen };
  }

  async function entriesForRef(refId: string): Promise<LedgerEntry[]> {
    return ds.getRepository(LedgerEntry).find({ where: { refId }, order: { createdAt: 'ASC' } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    ledger = app.get(LedgerService);

    // 迁移必须预置两个平台账户
    const platform = await ds
      .getRepository(Account)
      .find({ where: { id: In([PLATFORM_ACCOUNTS.escrow, PLATFORM_ACCOUNTS.income]) } });
    expect(platform).toHaveLength(2);
    expect(platform.every((a) => a.ownerUserId === null)).toBe(true);
    expect(platform.map((a) => a.kind).sort()).toEqual(['escrow', 'platform_income']);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      // 先删测试用户账户的流水，再删账户/用户；平台账户流水由本套测试产生，一并清理并归零。
      if (createdUserIds.length) {
        const accounts = await ds
          .getRepository(Account)
          .find({ where: { ownerUserId: In(createdUserIds) } });
        if (accounts.length) {
          await ds.getRepository(LedgerEntry).delete({ accountId: In(accounts.map((a) => a.id)) });
        }
      }
      await ds
        .getRepository(LedgerEntry)
        .delete({ accountId: In([PLATFORM_ACCOUNTS.escrow, PLATFORM_ACCOUNTS.income]) });
      if (createdUserIds.length) {
        await ds.getRepository(Account).delete({ ownerUserId: In(createdUserIds) });
        await ds.getRepository(User).delete({ id: In(createdUserIds) });
      }
      await ds.query(
        `UPDATE "accounts" SET "available" = 0, "frozen" = 0 WHERE "id" = ANY($1::uuid[])`,
        [[PLATFORM_ACCOUNTS.escrow, PLATFORM_ACCOUNTS.income]],
      );
    }
    await app.close();
  });

  it('transfer 前后总额不变；冻结→驳回往返无损；每笔动作留流水', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    // 充值 100 XM：系统总额 +100
    const depositRef = randomUUID();
    await ds.transaction(async (tx) => {
      await ledger.credit(tx, {
        userId: alice,
        amountMicro: 100n * XM,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: depositRef },
      });
    });
    const aliceAccount = await accountOf(alice);
    expect(await balancesOf(alice)).toEqual({ available: 100n * XM, frozen: 0n });

    const totalAfterCredit = await sumAll();
    const creditEntries = await entriesForRef(depositRef);
    expect(creditEntries).toHaveLength(1);
    expect(creditEntries[0]).toMatchObject({
      accountId: aliceAccount.id,
      userId: alice,
      kind: 'deposit_credit',
      refType: 'deposit',
      availableDelta: 100n * XM,
      frozenDelta: 0n,
      availableAfter: 100n * XM,
      frozenAfter: 0n,
    });

    // 冻结 20：总额不变，仅桶间移动
    const holdRef = randomUUID();
    await ds.transaction(async (tx) => {
      await ledger.freezeAvailable(tx, {
        userId: alice,
        amountMicro: 20n * XM,
        kind: 'withdrawal_hold',
        ref: { type: 'withdrawal', id: holdRef },
      });
    });
    expect(await balancesOf(alice)).toEqual({ available: 80n * XM, frozen: 20n * XM });
    expect(await sumAll()).toBe(totalAfterCredit);
    const holdEntries = await entriesForRef(holdRef);
    expect(holdEntries).toHaveLength(1);
    expect(holdEntries[0]).toMatchObject({
      accountId: aliceAccount.id,
      availableDelta: -20n * XM,
      frozenDelta: 20n * XM,
      availableAfter: 80n * XM,
      frozenAfter: 20n * XM,
    });

    // 驳回解冻：往返无损
    const rejectRef = randomUUID();
    await ds.transaction(async (tx) => {
      await ledger.unfreeze(tx, {
        userId: alice,
        amountMicro: 20n * XM,
        kind: 'withdrawal_reject',
        ref: { type: 'withdrawal', id: rejectRef },
      });
    });
    expect(await balancesOf(alice)).toEqual({ available: 100n * XM, frozen: 0n });
    expect(await sumAll()).toBe(totalAfterCredit);

    // transfer 40 XM：总额不变
    const transferRef = randomUUID();
    await ds.transaction(async (tx) => {
      await ledger.transfer(tx, {
        from: { userId: alice },
        to: { userId: bob },
        amountMicro: 40n * XM,
        kind: 'slot_payout',
        ref: { type: 'order', id: transferRef },
        memo: '测试转账',
      });
    });
    expect(await sumAll()).toBe(totalAfterCredit);
    expect(await balancesOf(alice)).toEqual({ available: 60n * XM, frozen: 0n });
    expect(await balancesOf(bob)).toEqual({ available: 40n * XM, frozen: 0n });

    // transfer 恰好两行（转出方 / 转入方），同 kind / ref
    const transferEntries = await entriesForRef(transferRef);
    expect(transferEntries).toHaveLength(2);
    expect(transferEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: aliceAccount.id,
          userId: alice,
          kind: 'slot_payout',
          refType: 'order',
          availableDelta: -40n * XM,
          frozenDelta: 0n,
          availableAfter: 60n * XM,
          memo: '测试转账',
        }),
        expect.objectContaining({
          accountId: (await accountOf(bob)).id,
          userId: bob,
          kind: 'slot_payout',
          refType: 'order',
          availableDelta: 40n * XM,
          frozenDelta: 0n,
          availableAfter: 40n * XM,
          memo: '测试转账',
        }),
      ]),
    );
  });

  it('余额不足抛 InsufficientFundsError，且分毫未动', async () => {
    const alice = await makeUser();
    await ds.transaction(async (tx) => {
      await ledger.credit(tx, {
        userId: alice,
        amountMicro: 10n * XM,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: randomUUID() },
      });
    });

    const accountsBefore = await ds
      .getRepository(Account)
      .find({ order: { id: 'ASC' } });
    const totalBefore = await sumAll();
    const refId = randomUUID();

    await expect(
      ds.transaction(async (tx) => {
        await ledger.transfer(tx, {
          from: { userId: alice },
          to: { platform: 'escrow' },
          amountMicro: 30n * XM,
          kind: 'order_freeze',
          ref: { type: 'order', id: refId },
        });
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    // 账户逐行（available/frozen）未动，总额未动，无流水
    const accountsAfter = await ds.getRepository(Account).find({ order: { id: 'ASC' } });
    expect(accountsAfter.map((a) => [a.id, a.available, a.frozen])).toEqual(
      accountsBefore.map((a) => [a.id, a.available, a.frozen]),
    );
    expect(await sumAll()).toBe(totalBefore);
    expect(await entriesForRef(refId)).toHaveLength(0);

    // 冻结超额同样失败且无流水
    const holdRef = randomUUID();
    await expect(
      ds.transaction(async (tx) => {
        await ledger.freezeAvailable(tx, {
          userId: alice,
          amountMicro: 11n * XM,
          kind: 'withdrawal_hold',
          ref: { type: 'withdrawal', id: holdRef },
        });
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await balancesOf(alice)).toEqual({ available: 10n * XM, frozen: 0n });
    expect(await entriesForRef(holdRef)).toHaveLength(0);

    // 余额不足时不得为收款方凭空创建账户（零余额账户也不写）
    const charlie = await makeUser();
    const charlieRef = randomUUID();
    await expect(
      ds.transaction(async (tx) => {
        await ledger.transfer(tx, {
          from: { userId: alice },
          to: { userId: charlie },
          amountMicro: 30n * XM,
          kind: 'slot_payout',
          ref: { type: 'order', id: charlieRef },
        });
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(
      await ds.getRepository(Account).findOne({ where: { ownerUserId: charlie } }),
    ).toBeNull();
    expect(await entriesForRef(charlieRef)).toHaveLength(0);

    // 未充值过的用户：转账直接失败，且不会凭空创建账户（无写入）
    const stranger = await makeUser();
    await expect(
      ds.transaction(async (tx) => {
        await ledger.transfer(tx, {
          from: { userId: stranger },
          to: { userId: alice },
          amountMicro: 1n * XM,
          kind: 'slot_payout',
          ref: { type: 'order', id: randomUUID() },
        });
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(
      await ds.getRepository(Account).findOne({ where: { ownerUserId: stranger } }),
    ).toBeNull();
  });

  it('consumeFrozen 让系统总额减少对应额', async () => {
    const alice = await makeUser();
    await ds.transaction(async (tx) => {
      await ledger.credit(tx, {
        userId: alice,
        amountMicro: 100n * XM,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: randomUUID() },
      });
    });

    const totalAfterCredit = await sumAll();

    await ds.transaction(async (tx) => {
      await ledger.freezeAvailable(tx, {
        userId: alice,
        amountMicro: 30n * XM,
        kind: 'withdrawal_hold',
        ref: { type: 'withdrawal', id: randomUUID() },
      });
    });
    expect(await sumAll()).toBe(totalAfterCredit);

    const paidRef = randomUUID();
    await ds.transaction(async (tx) => {
      await ledger.consumeFrozen(tx, {
        userId: alice,
        amountMicro: 30n * XM,
        kind: 'withdrawal_paid',
        ref: { type: 'withdrawal', id: paidRef },
      });
    });

    expect(await sumAll()).toBe(totalAfterCredit - 30n * XM);
    expect(await balancesOf(alice)).toEqual({ available: 70n * XM, frozen: 0n });

    const entries = await entriesForRef(paidRef);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'withdrawal_paid',
      availableDelta: 0n,
      frozenDelta: -30n * XM,
      availableAfter: 70n * XM,
      frozenAfter: 0n,
    });

    // 冻结额为 0 时再次 consumeFrozen → InsufficientFundsError
    await expect(
      ds.transaction(async (tx) => {
        await ledger.consumeFrozen(tx, {
          userId: alice,
          amountMicro: 1n,
          kind: 'withdrawal_paid',
          ref: { type: 'withdrawal', id: randomUUID() },
        });
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('并发：100 XM 余额上并发 5 笔 30 XM 转出 → 恰 3 笔成功、总额一致、无负数', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await ds.transaction(async (tx) => {
      await ledger.credit(tx, {
        userId: alice,
        amountMicro: 100n * XM,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: randomUUID() },
      });
    });
    const totalBefore = await sumAll();

    const refIds = Array.from({ length: 5 }, () => randomUUID());
    const results = await Promise.allSettled(
      refIds.map((refId) =>
        ds.transaction(async (tx) => {
          await ledger.transfer(tx, {
            from: { userId: alice },
            to: { userId: bob },
            amountMicro: 30n * XM,
            kind: 'slot_payout',
            ref: { type: 'order', id: refId },
          });
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    }

    // 余额精确：100 − 3×30 = 10；对手方 90
    expect(await balancesOf(alice)).toEqual({ available: 10n * XM, frozen: 0n });
    expect(await balancesOf(bob)).toEqual({ available: 90n * XM, frozen: 0n });
    expect(await sumAll()).toBe(totalBefore);

    // 任何账户不得为负
    const negative = await ds.query(
      `SELECT count(*)::int AS c FROM "accounts" WHERE "available" < 0 OR "frozen" < 0`,
    );
    expect(negative[0].c).toBe(0);

    // 成功 3 笔 × 两行流水 = 6 行；失败笔数不留流水
    const entryCount = await ds.query(
      `SELECT count(*)::int AS c FROM "ledger_entries" WHERE "ref_id" = ANY($1::uuid[])`,
      [refIds],
    );
    expect(entryCount[0].c).toBe(6);
  });

  it('双向并发转账不死锁：按 account.id 排序加锁 → 全部成功、总额不变', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    for (const userId of [alice, bob]) {
      await ds.transaction(async (tx) => {
        await ledger.credit(tx, {
          userId,
          amountMicro: 100n * XM,
          kind: 'deposit_credit',
          ref: { type: 'deposit', id: randomUUID() },
        });
      });
    }
    const totalBefore = await sumAll();

    // 20 笔反向并发（A→B / B→A 交替）；若锁顺序不一致，PostgreSQL 会以 40P01 死锁中止部分事务。
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => {
        const aliceToBob = i % 2 === 0;
        return ds.transaction((tx) =>
          ledger.transfer(tx, {
            from: { userId: aliceToBob ? alice : bob },
            to: { userId: aliceToBob ? bob : alice },
            amountMicro: XM,
            kind: 'slot_payout',
            ref: { type: 'order', id: randomUUID() },
          }),
        );
      }),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await sumAll()).toBe(totalBefore);
    expect(await balancesOf(alice)).toEqual({ available: 100n * XM, frozen: 0n });
    expect(await balancesOf(bob)).toEqual({ available: 100n * XM, frozen: 0n });
  });

  it('forfeitAll 把可用+冻结清零并全进 platform_income，返回没收额', async () => {
    const alice = await makeUser();

    await ds.transaction(async (tx) => {
      await ledger.credit(tx, {
        userId: alice,
        amountMicro: 100n * XM,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: randomUUID() },
      });
    });
    await ds.transaction(async (tx) => {
      await ledger.freezeAvailable(tx, {
        userId: alice,
        amountMicro: 30n * XM,
        kind: 'withdrawal_hold',
        ref: { type: 'withdrawal', id: randomUUID() },
      });
    });
    expect(await balancesOf(alice)).toEqual({ available: 70n * XM, frozen: 30n * XM });

    const incomeBefore = await platformBalance('income');
    const totalBefore = await sumAll();
    const ref = { type: 'user' as const, id: alice };

    const forfeited = await ds.transaction((tx) =>
      ledger.forfeitAll(tx, { userId: alice, ref }),
    );
    expect(forfeited).toBe(100n * XM);
    expect(await balancesOf(alice)).toEqual({ available: 0n, frozen: 0n });
    const incomeAfter = await platformBalance('income');
    expect(incomeAfter.available - incomeBefore.available).toBe(100n * XM);
    expect(incomeAfter.frozen).toBe(incomeBefore.frozen);
    expect(await sumAll()).toBe(totalBefore);

    // 两行流水：用户（available −70 / frozen −30）→ income（+100）
    const entries = await entriesForRef(alice);
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: (await accountOf(alice)).id,
          userId: alice,
          kind: 'forfeit',
          refType: 'user',
          availableDelta: -70n * XM,
          frozenDelta: -30n * XM,
          availableAfter: 0n,
          frozenAfter: 0n,
        }),
        expect.objectContaining({
          accountId: PLATFORM_ACCOUNTS.income,
          userId: null,
          kind: 'forfeit',
          refType: 'user',
          availableDelta: 100n * XM,
          frozenDelta: 0n,
        }),
      ]),
    );

    // 已清零后再没收 → 0，且不产生新流水
    const again = await ds.transaction((tx) => ledger.forfeitAll(tx, { userId: alice, ref }));
    expect(again).toBe(0n);
    expect(await entriesForRef(alice)).toHaveLength(2);

    // 从未有账户的用户 → 0，且不会凭空创建账户
    const stranger = await makeUser();
    const nothing = await ds.transaction((tx) =>
      ledger.forfeitAll(tx, { userId: stranger, ref: { type: 'user', id: stranger } }),
    );
    expect(nothing).toBe(0n);
    expect(
      await ds.getRepository(Account).findOne({ where: { ownerUserId: stranger } }),
    ).toBeNull();
  });

  it('金额为 0 或负 → BadRequestException 且无写入', async () => {
    const alice = await makeUser();
    const zeroRef = { type: 'deposit' as const, id: randomUUID() };

    await expect(
      ds.transaction((tx) =>
        ledger.credit(tx, {
          userId: alice,
          amountMicro: 0n,
          kind: 'deposit_credit',
          ref: zeroRef,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      ds.transaction((tx) =>
        ledger.credit(tx, {
          userId: alice,
          amountMicro: -1n,
          kind: 'deposit_credit',
          ref: zeroRef,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 校验先于建账户：没有任何写入
    expect(
      await ds.getRepository(Account).findOne({ where: { ownerUserId: alice } }),
    ).toBeNull();
    expect(await entriesForRef(zeroRef.id)).toHaveLength(0);
  });
});
