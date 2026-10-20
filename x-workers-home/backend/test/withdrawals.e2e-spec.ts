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
import { BindingChange } from '../src/bindings/binding-change.entity';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { PLATFORM_ACCOUNTS } from '../src/database/migrations/1700000003000-ledger';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { User } from '../src/users/user.entity';
import { Withdrawal } from '../src/withdrawals/withdrawal.entity';
import { WithdrawalsService } from '../src/withdrawals/withdrawals.service';

const XM = MICRO;

describe('提现 e2e（规则校验 + 立即冻结 + 人工审核流）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let withdrawals: WithdrawalsService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** 合法小写 BSC 地址：0x + 40 hex */
  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(
    address: string = randomAddress(),
    role: 'user' | 'admin' = 'user',
    opts: { status?: string; xBinding?: boolean } = {},
  ): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: address.toLowerCase(),
        status: opts.status ?? 'active',
        role,
      }),
    );
    createdUserIds.push(user.id);
    if (opts.xBinding !== false) {
      await ds.getRepository(XBinding).save(
        ds.getRepository(XBinding).create({
          userId: user.id,
          // handle 唯一且 ≤16 字符；与用户 id 绑定避免用例间冲突
          handle: `u${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          code: 'XWH-TEST',
          status: 'active',
          verifiedAt: new Date(),
        }),
      );
    }
    return user;
  }

  async function fund(userId: string, amountMicro: bigint): Promise<void> {
    await ds.transaction((tx) =>
      ledger.credit(tx, {
        userId,
        amountMicro,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: randomUUID() },
      }),
    );
  }

  async function balancesOf(
    userId: string,
  ): Promise<{ available: bigint; frozen: bigint }> {
    const account = await ds
      .getRepository(Account)
      .findOneOrFail({ where: { ownerUserId: userId } });
    return { available: account.available, frozen: account.frozen };
  }

  async function incomeBalance(): Promise<bigint> {
    const account = await ds
      .getRepository(Account)
      .findOneOrFail({ where: { id: PLATFORM_ACCOUNTS.income } });
    return account.available;
  }

  /** 真库全账户总额：Σ(available + frozen) */
  async function sumAll(): Promise<bigint> {
    const rows = await ds.query(
      `SELECT COALESCE(SUM("available" + "frozen"), 0)::text AS total FROM "accounts"`,
    );
    return BigInt(rows[0].total);
  }

  async function signToken(user: User): Promise<string> {
    return jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: process.env.JWT_SECRET, expiresIn: '1h' },
    );
  }

  function requestWithdrawal(token: string, amountXm: string) {
    return request(server())
      .post('/api/withdrawals/request')
      .set(auth(token))
      .send({ amountXm });
  }

  async function entriesOf(withdrawalId: string): Promise<LedgerEntry[]> {
    return ds.getRepository(LedgerEntry).find({
      where: { refType: 'withdrawal', refId: withdrawalId },
      order: { createdAt: 'ASC' },
    });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    ledger = app.get(LedgerService);
    withdrawals = app.get(WithdrawalsService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (createdUserIds.length) {
        await ds.getRepository(Withdrawal).delete({ userId: In(createdUserIds) });
        await ds.getRepository(BindingChange).delete({ userId: In(createdUserIds) });
        await ds.getRepository(XBinding).delete({ userId: In(createdUserIds) });
        const accounts = await ds
          .getRepository(Account)
          .find({ where: { ownerUserId: In(createdUserIds) } });
        if (accounts.length) {
          await ds
            .getRepository(LedgerEntry)
            .delete({ accountId: In(accounts.map((a) => a.id)) });
        }
        await ds.getRepository(Account).delete({ ownerUserId: In(createdUserIds) });
        await ds.getRepository(User).delete({ id: In(createdUserIds) });
      }
    }
    await app.close();
  });

  it('50 XM 申请 → fee 5 / payout 45 / 余额转冻结；仅能提到绑定钱包', async () => {
    const user = await makeUser();
    await fund(user.id, 100n * XM);
    const token = await signToken(user);

    // 未登录 401
    await request(server())
      .post('/api/withdrawals/request')
      .send({ amountXm: '50' })
      .expect(401);

    // 客户端传地址一律拒绝（whitelist + forbidNonWhitelisted）
    await request(server())
      .post('/api/withdrawals/request')
      .set(auth(token))
      .send({ amountXm: '50', address: randomAddress() })
      .expect(400);

    const res = await requestWithdrawal(token, '50').expect(201);
    expect(res.body).toMatchObject({
      amountXm: '50',
      feeXm: '5',
      payoutXm: '45',
      status: 'pending',
    });
    expect(res.body.id).toEqual(expect.any(String));

    const row = await ds
      .getRepository(Withdrawal)
      .findOneOrFail({ where: { id: res.body.id } });
    expect(row).toMatchObject({
      userId: user.id,
      // 地址取自 users.address（小写），不是客户端传入值
      address: user.address,
      amountMicro: 50n * XM,
      feeMicro: 5n * XM,
      payoutMicro: 45n * XM,
      status: 'pending',
      rejectReason: null,
      txHash: null,
      reviewedBy: null,
      reviewedAt: null,
    });

    // 可用 → 冻结，总额不变
    expect(await balancesOf(user.id)).toEqual({
      available: 50n * XM,
      frozen: 50n * XM,
    });
    const entries = await entriesOf(row.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: user.id,
      kind: 'withdrawal_hold',
      refType: 'withdrawal',
      refId: row.id,
      availableDelta: -50n * XM,
      frozenDelta: 50n * XM,
      availableAfter: 50n * XM,
      frozenAfter: 50n * XM,
    });

    // GET /mine：本人记录、字段、isFirst
    await request(server()).get('/api/withdrawals/mine').expect(401);
    const mine = await request(server())
      .get('/api/withdrawals/mine')
      .set(auth(token))
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({
      id: row.id,
      address: user.address,
      amountXm: '50',
      feeXm: '5',
      payoutXm: '45',
      status: 'pending',
      isFirst: true,
    });
  });

  it('49 / 55 / 50.5 / 超 6 位小数 → 400，且无任何资金变动', async () => {
    const user = await makeUser();
    await fund(user.id, 200n * XM);
    const token = await signToken(user);

    for (const amountXm of ['49', '55', '50.5', '50.0000001', 'abc', '']) {
      await requestWithdrawal(token, amountXm).expect(400);
    }

    expect(
      await ds.getRepository(Withdrawal).count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(await balancesOf(user.id)).toEqual({
      available: 200n * XM,
      frozen: 0n,
    });
  });

  it('24h 冷却：pending/approved/paid 均拦；23h59m 拦、恰 24h 不拦', async () => {
    const user = await makeUser();
    await fund(user.id, 200n * XM);
    const token = await signToken(user);

    const first = await requestWithdrawal(token, '50').expect(201);

    // 24h 内第二笔 → 400
    await requestWithdrawal(token, '50').expect(400);

    // approved / paid 同样处于冷却窗口
    for (const status of ['approved', 'paid']) {
      await ds.query(`UPDATE "withdrawals" SET "status" = $2 WHERE "id" = $1`, [
        first.body.id,
        status,
      ]);
      await requestWithdrawal(token, '50').expect(400);
    }

    // 23h59m 前仍拦
    await ds.query(
      `UPDATE "withdrawals"
          SET "status" = 'pending', "created_at" = now() - interval '23 hours 59 minutes'
        WHERE "id" = $1`,
      [first.body.id],
    );
    await requestWithdrawal(token, '50').expect(400);

    // 恰在 24h 前的一笔不拦（滚动窗口）
    await ds.query(
      `UPDATE "withdrawals"
          SET "created_at" = now() - interval '24 hours'
        WHERE "id" = $1`,
      [first.body.id],
    );
    const second = await requestWithdrawal(token, '50').expect(201);
    expect(second.body.id).not.toBe(first.body.id);

    // mine 倒序（新记录在前）
    const mine = await request(server())
      .get('/api/withdrawals/mine')
      .set(auth(token))
      .expect(200);
    expect(mine.body.map((w: any) => w.id)).toEqual([second.body.id, first.body.id]);
    expect(await balancesOf(user.id)).toEqual({
      available: 100n * XM,
      frozen: 100n * XM,
    });
  });

  it('并发两个申请（余额足够）→ 恰一个 201、一个 400，DB 仅一条 pending', async () => {
    const user = await makeUser();
    await fund(user.id, 100n * XM);
    const token = await signToken(user);

    const [first, second] = await Promise.all([
      requestWithdrawal(token, '50'),
      requestWithdrawal(token, '50'),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 400]);

    const rows = await ds
      .getRepository(Withdrawal)
      .find({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');

    // 只有成功的那笔冻结了余额
    expect(await balancesOf(user.id)).toEqual({
      available: 50n * XM,
      frozen: 50n * XM,
    });
    expect(
      await ds.getRepository(LedgerEntry).count({
        where: { refType: 'withdrawal', refId: rows[0].id },
      }),
    ).toBe(1);
  });

  it('rejected 后立即重发 → 允许（驳回不吃冷却，冻结退回可用）', async () => {
    const user = await makeUser();
    const admin = await makeUser(undefined, 'admin');
    await fund(user.id, 50n * XM);
    const token = await signToken(user);

    const first = await requestWithdrawal(token, '50').expect(201);
    expect(await balancesOf(user.id)).toEqual({
      available: 0n,
      frozen: 50n * XM,
    });

    const rejected = await withdrawals.reject(first.body.id, '地址风险', admin.id);
    expect(rejected).toMatchObject({
      id: first.body.id,
      status: 'rejected',
      rejectReason: '地址风险',
    });
    expect(rejected.reviewedBy).toBe(admin.id);
    expect(await balancesOf(user.id)).toEqual({
      available: 50n * XM,
      frozen: 0n,
    });

    const rejectEntry = (await entriesOf(first.body.id)).find(
      (e) => e.kind === 'withdrawal_reject',
    );
    expect(rejectEntry).toMatchObject({
      availableDelta: 50n * XM,
      frozenDelta: -50n * XM,
    });

    // rejected 不计入 24h 冷却 → 立即重发成功
    const again = await requestWithdrawal(token, '50').expect(201);
    expect(again.body.id).not.toBe(first.body.id);
    expect(await balancesOf(user.id)).toEqual({
      available: 0n,
      frozen: 50n * XM,
    });

    // 重复驳回 / 驳回已驳回 → 400
    await expect(
      withdrawals.reject(first.body.id, 'again', admin.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    // 不存在的记录 → 404
    await expect(
      withdrawals.reject(randomUUID(), 'nope', admin.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approve + markPaid：实付出系统（−payout）、手续费入平台收入、冻结清零、tx_hash 落库、重复打款 400', async () => {
    const user = await makeUser();
    const admin = await makeUser(undefined, 'admin');
    await fund(user.id, 100n * XM);
    const token = await signToken(user);

    const created = await requestWithdrawal(token, '50').expect(201);

    // pending 不能直接打款
    await expect(
      withdrawals.markPaid(created.body.id, '0x' + 'a'.repeat(64), admin.id),
    ).rejects.toBeInstanceOf(BadRequestException);

    const approved = await withdrawals.approve(created.body.id, admin.id);
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe(admin.id);
    expect(approved.reviewedAt).toBeInstanceOf(Date);
    // 重复/非法状态审核 → 400
    await expect(
      withdrawals.approve(created.body.id, admin.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      withdrawals.approve(randomUUID(), admin.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    const totalBefore = await sumAll();
    const incomeBefore = await incomeBalance();
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const paid = await withdrawals.markPaid(created.body.id, txHash, admin.id);
    expect(paid).toMatchObject({
      id: created.body.id,
      status: 'paid',
      txHash,
    });
    expect(paid.reviewedBy).toBe(admin.id);

    // 记账拆分：45 实付出系统（系统总额 −payout），5 手续费转入 platform_income；
    // 用户侧冻结清零、可用余额不变。
    expect(await sumAll()).toBe(totalBefore - 45n * XM);
    expect(await incomeBalance()).toBe(incomeBefore + 5n * XM);
    expect(await balancesOf(user.id)).toEqual({
      available: 50n * XM,
      frozen: 0n,
    });

    const entries = await entriesOf(created.body.id);
    const paidEntry = entries.find((e) => e.kind === 'withdrawal_paid');
    expect(paidEntry).toMatchObject({
      availableDelta: 0n,
      frozenDelta: -45n * XM,
      availableAfter: 50n * XM,
      frozenAfter: 5n * XM,
    });

    // 手续费：冻结 → 可用（unfreeze）→ platform_income（transfer），共 3 行
    const feeEntries = entries.filter((e) => e.kind === 'withdrawal_fee');
    expect(feeEntries).toHaveLength(3);
    const userFeeEntries = feeEntries.filter((e) => e.userId === user.id);
    expect(userFeeEntries).toHaveLength(2);
    expect(userFeeEntries.map((e) => [e.availableDelta, e.frozenDelta])).toEqual(
      expect.arrayContaining([
        [5n * XM, -5n * XM],
        [-5n * XM, 0n],
      ]),
    );
    const incomeFeeEntry = feeEntries.find((e) => e.userId === null);
    expect(incomeFeeEntry).toMatchObject({
      availableDelta: 5n * XM,
      frozenDelta: 0n,
    });

    // 重复打款 → 400，且不重复出账
    await expect(
      withdrawals.markPaid(created.body.id, txHash, admin.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await sumAll()).toBe(totalBefore - 45n * XM);
    expect(await incomeBalance()).toBe(incomeBefore + 5n * XM);

    // 有 paid 记录后 isFirst 翻为 false
    const mine = await request(server())
      .get('/api/withdrawals/mine')
      .set(auth(token))
      .expect(200);
    expect(mine.body[0]).toMatchObject({ status: 'paid', isFirst: false });
  });

  it('存在未生效的钱包或 X 改绑 → 均 400', async () => {
    const user = await makeUser();
    await fund(user.id, 100n * XM);
    const token = await signToken(user);

    const change = await ds.getRepository(BindingChange).save(
      ds.getRepository(BindingChange).create({
        userId: user.id,
        kind: 'wallet',
        newValue: randomAddress(),
        status: 'pending',
        effectiveAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        appliedAt: null,
      }),
    );

    const blocked = await requestWithdrawal(token, '50').expect(400);
    expect(blocked.body.message).toContain('改绑');
    expect(
      await ds.getRepository(Withdrawal).count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(await balancesOf(user.id)).toEqual({
      available: 100n * XM,
      frozen: 0n,
    });

    // 双绑齐备 + 改绑冷静期：X 改绑同样拦截（不限 kind）
    change.kind = 'x';
    await ds.getRepository(BindingChange).save(change);
    const blockedByX = await requestWithdrawal(token, '50').expect(400);
    expect(blockedByX.body.message).toContain('改绑');
    expect(
      await ds.getRepository(Withdrawal).count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(await balancesOf(user.id)).toEqual({
      available: 100n * XM,
      frozen: 0n,
    });
  });

  it('账号非 active（pending_x_binding）→ 400，无资金变动', async () => {
    const user = await makeUser(undefined, 'user', { status: 'pending_x_binding' });
    await fund(user.id, 100n * XM);
    const token = await signToken(user);

    const res = await requestWithdrawal(token, '50').expect(400);
    expect(res.body.message).toContain('激活');
    expect(
      await ds.getRepository(Withdrawal).count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(await balancesOf(user.id)).toEqual({
      available: 100n * XM,
      frozen: 0n,
    });
  });

  it('无 X 绑定 → 400「请先完成 X 绑定」，无资金变动', async () => {
    const user = await makeUser(undefined, 'user', { xBinding: false });
    await fund(user.id, 100n * XM);
    const token = await signToken(user);

    const res = await requestWithdrawal(token, '50').expect(400);
    expect(res.body.message).toBe('请先完成 X 绑定');
    expect(
      await ds.getRepository(Withdrawal).count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(await balancesOf(user.id)).toEqual({
      available: 100n * XM,
      frozen: 0n,
    });
  });

  it('未绑定 / 非法绑定钱包地址 → 400', async () => {
    const user = await makeUser('not-a-wallet');
    await fund(user.id, 100n * XM);
    const token = await signToken(user);

    const res = await requestWithdrawal(token, '50').expect(400);
    expect(res.body.message).toContain('钱包');
    expect(
      await ds.getRepository(Withdrawal).count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(await balancesOf(user.id)).toEqual({
      available: 100n * XM,
      frozen: 0n,
    });
  });

  it('余额不足 → 400（freezeAvailable 兜底），事务回滚不留 withdrawal 行', async () => {
    const user = await makeUser();
    await fund(user.id, 40n * XM); // 满足规则但余额不够 50
    const token = await signToken(user);

    await requestWithdrawal(token, '50').expect(400);

    expect(
      await ds.getRepository(Withdrawal).count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(await balancesOf(user.id)).toEqual({
      available: 40n * XM,
      frozen: 0n,
    });
  });
});
