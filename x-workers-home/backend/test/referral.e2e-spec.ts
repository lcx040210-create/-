import { BadRequestException, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HDNodeWallet, Wallet } from 'ethers';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { BindingChange } from '../src/bindings/binding-change.entity';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { PLATFORM_ACCOUNTS } from '../src/database/migrations/1700000003000-ledger';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { Referral } from '../src/referral/referral.entity';
import { ReferralService, generateRefCode } from '../src/referral/referral.service';
import { User } from '../src/users/user.entity';
import { Withdrawal } from '../src/withdrawals/withdrawal.entity';
import { WithdrawalsService } from '../src/withdrawals/withdrawals.service';

const XM = MICRO;

/** 6 位大写字母数字，排除易混字符 0/1/I/O。 */
const REF_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

describe('邀请返佣 e2e（20/30/40 档位 + 手续费钩子）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let referral: ReferralService;
  let withdrawals: WithdrawalsService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(
    opts: { address?: string; status?: string; refCode?: string | null } = {},
  ): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: (opts.address ?? randomAddress()).toLowerCase(),
        status: opts.status ?? 'active',
        role: 'user',
        refCode: opts.refCode === undefined ? generateRefCode() : opts.refCode,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  /** 建邀请关系行（默认被邀人 active）。 */
  async function bindRow(referrer: User, status = 'active'): Promise<User> {
    const invitee = await makeUser({ status });
    await ds.getRepository(Referral).insert({
      referrerUserId: referrer.id,
      inviteeUserId: invitee.id,
    });
    return invitee;
  }

  async function availableOf(userId: string): Promise<bigint> {
    const account = await ds
      .getRepository(Account)
      .findOne({ where: { ownerUserId: userId } });
    return account?.available ?? 0n;
  }

  async function incomeAvailable(): Promise<bigint> {
    const account = await ds
      .getRepository(Account)
      .findOneOrFail({ where: { id: PLATFORM_ACCOUNTS.income } });
    return account.available;
  }

  /** 清零平台收入账户：验证「income 从 0 起步」也不依赖预充值。 */
  async function resetIncome(): Promise<void> {
    await ds.query(
      `UPDATE "accounts" SET "available" = 0 WHERE "id" = $1`,
      [PLATFORM_ACCOUNTS.income],
    );
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

  /**
   * 模拟真实手续费链路：被邀人付费 → platform_income，同一事务内触发返佣。
   * 返佣 ≤ 40% 手续费 → income 先入后出，结构上不可能余额不足。
   */
  async function payFeeAndRebate(
    feePayer: User,
    feeMicro: bigint,
    feeKind: string,
  ): Promise<void> {
    await fund(feePayer.id, feeMicro);
    await ds.transaction(async (tx) => {
      await ledger.transfer(tx, {
        from: { userId: feePayer.id },
        to: { platform: 'income' },
        amountMicro: feeMicro,
        kind: feeKind === 'withdrawal' ? 'withdrawal_fee' : 'completion_fee',
        ref: { type: 'user', id: feePayer.id },
      });
      await referral.onFeeEvent(tx, {
        userId: feePayer.id,
        feeMicro,
        feeKind,
      });
    });
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

  /** nonce → 签名 → verify，断言目标状态码并返回响应。 */
  async function verifyWallet(
    wallet: Wallet | HDNodeWallet,
    referralCode?: string,
    expectedStatus = 201,
  ) {
    const { body: nonceBody } = await request(server())
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(201);
    const signature = await wallet.signMessage(nonceBody.message);
    const terms = await request(server()).get('/api/terms/current').expect(200);
    const payload: Record<string, unknown> = {
      address: wallet.address,
      signature,
      termsVersion: terms.body.version,
    };
    if (referralCode !== undefined) payload.referralCode = referralCode;
    return request(server())
      .post('/api/auth/verify')
      .send(payload)
      .expect(expectedStatus);
  }

  function rebateEntriesOf(userId: string): Promise<LedgerEntry[]> {
    return ds.getRepository(LedgerEntry).find({
      where: { userId, kind: 'referral_rebate' },
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
    referral = app.get(ReferralService);
    withdrawals = app.get(WithdrawalsService);
    jwt = app.get(JwtService);

    await resetIncome();
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (createdUserIds.length) {
        await ds.getRepository(Withdrawal).delete({ userId: In(createdUserIds) });
        await ds.getRepository(BindingChange).delete({ userId: In(createdUserIds) });
        await ds
          .getRepository(RefreshToken)
          .delete({ userId: In(createdUserIds) });
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

  it('档位边界：4 人 20% / 5 人 30% / 9 人 30% / 10 人 40%；inactive 不计', async () => {
    // [active 数, inactive 数, 期望档位]；100 XM 手续费 → 返佣恰为档位 XM
    const cases: Array<[number, number, number]> = [
      [4, 0, 20],
      [5, 0, 30],
      [9, 0, 30],
      [10, 0, 40],
      [4, 3, 20],
    ];

    for (const [activeCount, inactiveCount, rate] of cases) {
      const referrer = await makeUser();
      let feePayer: User | null = null;
      for (let i = 0; i < activeCount; i++) {
        feePayer = await bindRow(referrer, 'active');
      }
      for (let i = 0; i < inactiveCount; i++) {
        await bindRow(referrer, 'pending_x_binding');
      }
      expect(feePayer).not.toBeNull();

      const before = await availableOf(referrer.id);
      const feeMicro = 100n * XM;
      await payFeeAndRebate(feePayer!, feeMicro, 'completion');

      expect(await availableOf(referrer.id)).toBe(before + BigInt(rate) * XM);
      const entries = await rebateEntriesOf(referrer.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: 'referral_rebate',
        refType: 'user',
        refId: feePayer!.id,
        availableDelta: BigInt(rate) * XM,
      });
      expect(entries[0].memo).toContain('completion');
      expect(entries[0].memo).toContain(`${rate}%`);
    }
  });

  it('5 XM 手续费 → 20% 档返 1 XM；income 从 0 起步也不失败', async () => {
    await resetIncome();
    expect(await incomeAvailable()).toBe(0n);

    const referrer = await makeUser();
    const invitee = await bindRow(referrer, 'active');

    const referrerBefore = await availableOf(referrer.id);

    // 同一事务：5 XM 手续费先入 income，再按 20% 发 1 XM 返佣（自供资）
    await payFeeAndRebate(invitee, 5n * XM, 'completion');

    expect(await availableOf(referrer.id)).toBe(referrerBefore + 1n * XM);
    // 平台净收 = 5 − 1 = 4 XM
    expect(await incomeAvailable()).toBe(4n * XM);
    const entries = await rebateEntriesOf(referrer.id);
    expect(entries).toEqual([
      expect.objectContaining({
        refType: 'user',
        refId: invitee.id,
        availableDelta: 1n * XM,
        memo: expect.stringContaining('20%'),
      }),
    ]);
  });

  it('注册带有效邀请码 → 同事务绑定；无效码 → 400 且不建号', async () => {
    const referrer = await makeUser();
    const wallet = Wallet.createRandom();

    const res = await verifyWallet(wallet, referrer.refCode!);
    const user = await ds
      .getRepository(User)
      .findOneOrFail({ where: { address: wallet.address.toLowerCase() } });
    createdUserIds.push(user.id);

    expect(res.body.user.id).toBe(user.id);
    // 新用户自己的邀请码：6 位、唯一、与邀请人不同
    expect(user.refCode).toMatch(REF_CODE_PATTERN);
    expect(user.refCode).not.toBe(referrer.refCode);

    const binding = await ds
      .getRepository(Referral)
      .findOneOrFail({ where: { inviteeUserId: user.id } });
    expect(binding.referrerUserId).toBe(referrer.id);

    // 无效码：0 不在字母表内，绝不可能是已生成的码；400 且整事务回滚不建号
    const stranger = Wallet.createRandom();
    const bad = await verifyWallet(stranger, '000000', 400);
    expect(bad.body.message).toContain('邀请码无效');
    expect(
      await ds
        .getRepository(User)
        .count({ where: { address: stranger.address.toLowerCase() } }),
    ).toBe(0);
  });

  it('自邀被拒；已存在用户再次 verify → 忽略邀请码、不重绑', async () => {
    const referrer = await makeUser();
    const invitee = await makeUser();

    // 自邀：邀请人地址作为被邀人地址 → 400（注册路径的防御性校验）
    await expect(
      ds.transaction((tx) =>
        referral.bindInvitee(tx, {
          inviteeUserId: invitee.id,
          inviteeAddress: referrer.address,
          code: referrer.refCode!,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await ds.getRepository(Referral).count({ where: { inviteeUserId: invitee.id } }),
    ).toBe(0);

    // 已注册用户（登录）带 code → 201 但完全忽略，不重绑
    const wallet = Wallet.createRandom();
    const first = await verifyWallet(wallet);
    const user = await ds
      .getRepository(User)
      .findOneOrFail({ where: { id: first.body.user.id } });
    createdUserIds.push(user.id);

    const again = await verifyWallet(wallet, referrer.refCode!);
    expect(again.body.user.id).toBe(user.id);
    expect(
      await ds.getRepository(Referral).count({ where: { inviteeUserId: user.id } }),
    ).toBe(0);
  });

  it('被邀人提现 markPaid → 提现费 5 XM 产生 1 XM 返佣（income 从 0 起步）', async () => {
    // income 清空：打款流程自身把手续费入账，再发返佣，不依赖任何预充值
    await resetIncome();
    expect(await incomeAvailable()).toBe(0n);

    const referrer = await makeUser();
    const invitee = await bindRow(referrer, 'active');
    const admin = await makeUser();
    await fund(invitee.id, 100n * XM);
    const token = await signToken(invitee);

    const created = await requestWithdrawal(token, '50').expect(201);
    expect(created.body).toMatchObject({ feeXm: '5', status: 'pending' });

    await withdrawals.approve(created.body.id, admin.id);

    const referrerBefore = await availableOf(referrer.id);
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const paid = await withdrawals.markPaid(created.body.id, txHash, admin.id);
    expect(paid).toMatchObject({ id: created.body.id, status: 'paid', txHash });

    // 提现费 5 XM 先入 income，再按 20% 返 1 XM → 平台净收 4 XM
    expect(await incomeAvailable()).toBe(4n * XM);
    expect(await availableOf(referrer.id)).toBe(referrerBefore + 1n * XM);
    const entries = await rebateEntriesOf(referrer.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      refType: 'user',
      refId: invitee.id,
      availableDelta: 1n * XM,
    });
    expect(entries[0].memo).toContain('withdrawal');
    expect(entries[0].memo).toContain('20%');
  });

  it('无邀请人 → onFeeEvent / markPaid 均 no-op 且不报错', async () => {
    const user = await makeUser();
    const before = await availableOf(user.id);

    await expect(
      ds.transaction((tx) =>
        referral.onFeeEvent(tx, {
          userId: user.id,
          feeMicro: 5n * XM,
          feeKind: 'posting',
        }),
      ),
    ).resolves.toBeUndefined();
    expect(await availableOf(user.id)).toBe(before);
    expect(
      await ds.getRepository(LedgerEntry).count({
        where: { kind: 'referral_rebate', refType: 'user', refId: user.id },
      }),
    ).toBe(0);

    // 无邀请人的真实提现打款流程照常完成；手续费仍入 platform_income
    const admin = await makeUser();
    await fund(user.id, 50n * XM);
    const token = await signToken(user);
    const created = await requestWithdrawal(token, '50').expect(201);
    await withdrawals.approve(created.body.id, admin.id);
    const incomeBefore = await incomeAvailable();
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    await expect(
      withdrawals.markPaid(created.body.id, txHash, admin.id),
    ).resolves.toMatchObject({ status: 'paid' });
    expect(await incomeAvailable()).toBe(incomeBefore + 5n * XM);
    expect(
      await ds.getRepository(LedgerEntry).count({
        where: { kind: 'referral_rebate', refType: 'user', refId: user.id },
      }),
    ).toBe(0);
  });

  it('GET /api/referral/mine：code / active 人数 / 档位 / 累计返佣', async () => {
    const referrer = await makeUser();
    let feePayer: User | null = null;
    for (let i = 0; i < 5; i++) {
      const invitee = await bindRow(referrer, 'active');
      if (!feePayer) feePayer = invitee;
    }
    await bindRow(referrer, 'pending_x_binding'); // 非 active 不计

    // 5 名 active 被邀人 → 30%；100 XM × 30% = 30 XM
    await payFeeAndRebate(feePayer!, 100n * XM, 'completion');

    await request(server()).get('/api/referral/mine').expect(401);

    const token = await signToken(referrer);
    const res = await request(server())
      .get('/api/referral/mine')
      .set(auth(token))
      .expect(200);
    expect(res.body).toEqual({
      code: referrer.refCode,
      inviteesCount: 5,
      tier: 30,
      rebateTotalXm: '30',
    });
  });
});
