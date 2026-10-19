import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { BindingChange } from '../src/bindings/binding-change.entity';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { PLATFORM_ACCOUNTS } from '../src/database/migrations/1700000003000-ledger';
import { Deposit } from '../src/deposits/deposit.entity';
import { Dispute } from '../src/disputes/dispute.entity';
import { VerificationJob } from '../src/jobs/verification-job.entity';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { Notification } from '../src/notifications/notification.entity';
import { Order } from '../src/orders/order.entity';
import { Referral } from '../src/referral/referral.entity';
import { OrderSlot } from '../src/slots/order-slot.entity';
import { SlotsService } from '../src/slots/slots.service';
import { User } from '../src/users/user.entity';
import { Withdrawal } from '../src/withdrawals/withdrawal.entity';
import {
  XNotFoundError,
  XScraperService,
  XUpstreamError,
} from '../src/xscraper/xscraper.service';
import { XTweet } from '../src/xscraper/xscraper.types';

jest.setTimeout(30_000);

const XM = MICRO;
const ADMIN_PASSWORD = 'admin-pass-123';

const fakeScraper = {
  getTweet: jest.fn(),
  getProfile: jest.fn(),
  getRecentTweets: jest.fn(),
};

describe('Admin e2e（登录/守卫、审核队列、抽查与罚则）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let scheduler: SchedulerService;
  let slotsService: SlotsService;
  let jwt: JwtService;

  let admin: User;
  let adminToken: string;

  const createdUserIds: string[] = [];
  const createdDepositIds: string[] = [];
  let handleSeq = 0;
  let tweetSeq = 0;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(
    opts: {
      address?: string;
      role?: 'user' | 'admin';
      status?: string;
      passwordHash?: string | null;
    } = {},
  ): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: (opts.address ?? randomAddress()).toLowerCase(),
        status: opts.status ?? 'active',
        role: opts.role ?? 'user',
        passwordHash: opts.passwordHash ?? null,
        nickname: null,
        ratingGrade: null,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function makeTaker(): Promise<{ user: User; binding: XBinding }> {
    const user = await makeUser();
    const handle = `k${randomUUID().replace(/-/g, '').slice(0, 10)}${handleSeq++}`.slice(0, 15);
    const binding = await ds.getRepository(XBinding).save(
      ds.getRepository(XBinding).create({
        userId: user.id,
        handle,
        code: 'XWH-TEST01',
        status: 'active',
        verifiedAt: new Date(),
      }),
    );
    return { user, binding };
  }

  async function bindX(userId: string): Promise<XBinding> {
    const handle = `m${randomUUID().replace(/-/g, '').slice(0, 10)}${handleSeq++}`.slice(0, 15);
    return ds.getRepository(XBinding).save(
      ds.getRepository(XBinding).create({
        userId,
        handle,
        code: 'XWH-TEST01',
        status: 'active',
        verifiedAt: new Date(),
      }),
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

  async function availableOf(userId: string): Promise<bigint> {
    const account = await ds
      .getRepository(Account)
      .findOne({ where: { ownerUserId: userId } });
    return account?.available ?? 0n;
  }

  async function platformAvailable(id: string): Promise<bigint> {
    const account = await ds.getRepository(Account).findOneOrFail({ where: { id } });
    return account.available;
  }

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

  async function makeOrder(
    merchantToken: string,
    opts: { priceXm?: string; slots?: number; title?: string } = {},
  ): Promise<string> {
    const res = await request(server())
      .post('/api/orders')
      .set(auth(merchantToken))
      .send({
        type: 'post',
        title: opts.title ?? 'Admin 抽查商单',
        brief: '测试用商单说明',
        requirements: { keywords: [], hashtags: [], mentions: [], links: [] },
        priceXm: opts.priceXm ?? '100',
        slots: opts.slots ?? 1,
      })
      .expect(201);
    return res.body.id as string;
  }

  const take = (token: string, orderId: string) =>
    request(server()).post(`/api/orders/${orderId}/take`).set(auth(token));

  const deliver = (token: string, slotId: string, deliveryUrl: string) =>
    request(server())
      .post(`/api/slots/${slotId}/deliver`)
      .set(auth(token))
      .send({ deliveryUrl });

  const confirm = (token: string, slotId: string) =>
    request(server()).post(`/api/slots/${slotId}/confirm`).set(auth(token));

  function tweetUrl(handle: string): string {
    tweetSeq += 1;
    return `https://x.com/${handle}/status/${1770000000000000000n + BigInt(tweetSeq)}`;
  }

  function makeTweet(handle: string, text = 'admin check tweet'): XTweet {
    tweetSeq += 1;
    const id = 1780000000000000000n + BigInt(tweetSeq);
    return {
      id: String(id),
      url: `https://x.com/${handle}/status/${id}`,
      created_at: new Date().toISOString(),
      author: { handle, name: handle },
      text,
    };
  }

  const loadSlot = (id: string) =>
    ds.getRepository(OrderSlot).findOneOrFail({ where: { id } });
  const loadOrder = (id: string) =>
    ds.getRepository(Order).findOneOrFail({ where: { id } });

  async function adminActions(action: string, targetId?: string): Promise<any[]> {
    return targetId
      ? ds.query(
          `SELECT * FROM "admin_actions" WHERE "action" = $1 AND "target_id" = $2 ORDER BY "created_at" ASC`,
          [action, targetId],
        )
      : ds.query(
          `SELECT * FROM "admin_actions" WHERE "action" = $1 ORDER BY "created_at" ASC`,
          [action],
        );
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(XScraperService)
      .useValue(fakeScraper)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    ledger = app.get(LedgerService);
    scheduler = app.get(SchedulerService);
    slotsService = app.get(SlotsService);
    jwt = app.get(JwtService);

    admin = await makeUser({
      role: 'admin',
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4),
    });

    const login = await request(server())
      .post('/api/admin/login')
      .send({ address: admin.address, password: ADMIN_PASSWORD })
      .expect(200);
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    try {
      if (ds?.isInitialized) {
        await ds.query(`DELETE FROM "admin_actions"`).catch(() => undefined);
        if (createdUserIds.length) {
          await ds.query(
            `DELETE FROM "verification_jobs" WHERE "ref_id" = ANY($1::text[])`,
            [createdUserIds],
          );
          await ds.query(
            `DELETE FROM "verification_jobs"
              WHERE "ref_id" IN (
                SELECT s."id"::text FROM "order_slots" s
                 WHERE s."order_id" IN (
                   SELECT o."id" FROM "orders" o WHERE o."merchant_user_id" = ANY($1::uuid[])
                 )
              )`,
            [createdUserIds],
          );
          await ds.getRepository(Order).delete({ merchantUserId: In(createdUserIds) });
          await ds.getRepository(Notification).delete({ userId: In(createdUserIds) });
          await ds.getRepository(Referral).delete({ inviteeUserId: In(createdUserIds) });
          await ds.getRepository(Referral).delete({ referrerUserId: In(createdUserIds) });
          await ds.getRepository(XBinding).delete({ userId: In(createdUserIds) });
          await ds.getRepository(BindingChange).delete({ userId: In(createdUserIds) });
          await ds.query(`DELETE FROM "withdrawals" WHERE "user_id" = ANY($1::uuid[])`, [
            createdUserIds,
          ]);
          await ds.query(`DELETE FROM "deposits" WHERE "user_id" = ANY($1::uuid[])`, [
            createdUserIds,
          ]);
          if (createdDepositIds.length) {
            await ds.query(`DELETE FROM "deposits" WHERE "id" = ANY($1::uuid[])`, [
              createdDepositIds,
            ]);
          }
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
      }
    } finally {
      await app?.close();
    }
  });

  beforeEach(async () => {
    fakeScraper.getTweet.mockReset();
    fakeScraper.getTweet.mockRejectedValue(new XUpstreamError('fake: 未排队的推文'));
    fakeScraper.getProfile.mockReset();
    fakeScraper.getRecentTweets.mockReset();
  });

  it('admin 登录：bcrypt 校验、role 来自 DB；密码错/非 admin 401；非 admin JWT 403', async () => {
    // 成功：token payload role=admin，user 视图来自 DB。
    const ok = await request(server())
      .post('/api/admin/login')
      .send({ address: admin.address, password: ADMIN_PASSWORD })
      .expect(200);
    expect(ok.body.user).toMatchObject({
      id: admin.id,
      address: admin.address,
      role: 'admin',
      status: 'active',
    });
    const payload = await jwt.verifyAsync(ok.body.accessToken, {
      secret: process.env.JWT_SECRET,
    });
    expect(payload).toMatchObject({ sub: admin.id, role: 'admin' });

    // 密码错 → 401。
    await request(server())
      .post('/api/admin/login')
      .send({ address: admin.address, password: 'wrong-password' })
      .expect(401);

    // 普通用户即使密码正确也不是 admin → 401。
    const normal = await makeUser({
      passwordHash: await bcrypt.hash('normal-pass', 4),
    });
    await request(server())
      .post('/api/admin/login')
      .send({ address: normal.address, password: 'normal-pass' })
      .expect(401);

    // 不存在的地址 → 401。
    await request(server())
      .post('/api/admin/login')
      .send({ address: randomAddress(), password: 'whatever' })
      .expect(401);

    // 未登录 → 401；普通用户 JWT → 403；admin JWT → 200。
    await request(server()).get('/api/admin/withdrawals').expect(401);
    const normalToken = await signToken(normal);
    await request(server())
      .get('/api/admin/withdrawals')
      .set(auth(normalToken))
      .expect(403);
    await request(server())
      .get('/api/admin/withdrawals')
      .set(auth(adminToken))
      .expect(200);
  });

  it('提现队列 flags：首提/新地址/24h 其他申请', async () => {
    const u1 = await makeUser(); // 无 paid，两笔近期申请
    const u2 = await makeUser(); // 有 paid，且地址与上次一致
    const u3 = await makeUser(); // 有 paid，但地址变化

    const insertWithdrawal = async (
      userId: string,
      address: string,
      status: string,
      createdAt: Date,
    ): Promise<string> => {
      const rows = await ds.query(
        `INSERT INTO "withdrawals"
           ("user_id", "address", "amount_micro", "fee_micro", "payout_micro", "status", "created_at")
         VALUES ($1, $2, 50000000, 5000000, 45000000, $3, $4)
         RETURNING "id"`,
        [userId, address, status, createdAt],
      );
      return rows[0].id;
    };

    const now = Date.now();
    await insertWithdrawal(u1.id, u1.address, 'pending', new Date(now));
    await insertWithdrawal(u1.id, u1.address, 'pending', new Date(now - 3600_000));

    await insertWithdrawal(u2.id, u2.address, 'paid', new Date(now - 3 * 86400_000));
    const u2Pending = await insertWithdrawal(u2.id, u2.address, 'pending', new Date(now));

    await insertWithdrawal(u3.id, u3.address, 'paid', new Date(now - 3 * 86400_000));
    const u3Pending = await insertWithdrawal(u3.id, randomAddress(), 'pending', new Date(now));

    const res = await request(server())
      .get('/api/admin/withdrawals?status=pending')
      .set(auth(adminToken))
      .expect(200);
    const body = res.body as any[];
    const pick = (id: string) => body.find((row) => row.id === id);

    const u1Rows = body.filter((row) => row.userId === u1.id);
    expect(u1Rows).toHaveLength(2);
    for (const row of u1Rows) {
      expect(row).toMatchObject({
        isFirst: true,
        isNewAddress: true,
        flagged24h: true,
      });
      expect(row.user).toMatchObject({ id: u1.id, address: u1.address });
      expect(row.amountXm).toBe('50');
      expect(row.feeXm).toBe('5');
      expect(row.payoutXm).toBe('45');
    }

    expect(pick(u2Pending)).toMatchObject({
      isFirst: false,
      isNewAddress: false,
      flagged24h: false,
    });
    expect(pick(u3Pending)).toMatchObject({
      isFirst: false,
      isNewAddress: true,
      flagged24h: false,
    });
  });

  it('提现审核：approve → paid（冻结出账）；reject 退回可用；每步落审计', async () => {
    const user = await makeUser();
    const token = await signToken(user);
    await fund(user.id, 300n * XM);

    const created = await request(server())
      .post('/api/withdrawals/request')
      .set(auth(token))
      .send({ amountXm: '50' })
      .expect(201);
    const withdrawalId = created.body.id;

    const approved = await request(server())
      .post(`/api/admin/withdrawals/${withdrawalId}/approve`)
      .set(auth(adminToken))
      .expect(200);
    expect(approved.body).toMatchObject({ id: withdrawalId, status: 'approved' });
    expect(approved.body.reviewedBy).toBe(admin.id);
    const approveActions = await adminActions('withdrawal_approve', withdrawalId);
    expect(approveActions).toHaveLength(1);
    expect(approveActions[0].detail).toMatchObject({
      intent: false,
      status: 'approved',
    });

    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const paid = await request(server())
      .post(`/api/admin/withdrawals/${withdrawalId}/paid`)
      .set(auth(adminToken))
      .send({ txHash })
      .expect(200);
    expect(paid.body).toMatchObject({ id: withdrawalId, status: 'paid', txHash });
    const paidActions = await adminActions('withdrawal_paid', withdrawalId);
    expect(paidActions).toHaveLength(1);
    expect(paidActions[0].detail).toMatchObject({
      intent: false,
      status: 'paid',
      txHash,
    });
    expect(await availableOf(user.id)).toBe(250n * XM);

    // 已 paid 再打款 → 400，不重复出账；失败的 admin 操作仍留 intent=true 审计。
    await request(server())
      .post(`/api/admin/withdrawals/${withdrawalId}/paid`)
      .set(auth(adminToken))
      .send({ txHash })
      .expect(400);
    expect(await availableOf(user.id)).toBe(250n * XM);

    const paidActionsAfterFailure = await adminActions(
      'withdrawal_paid',
      withdrawalId,
    );
    expect(paidActionsAfterFailure).toHaveLength(2);
    expect(
      paidActionsAfterFailure.filter((row) => row.detail.intent === false),
    ).toHaveLength(1);
    const failedIntent = paidActionsAfterFailure.find(
      (row) => row.detail.intent === true,
    );
    expect(failedIntent).toBeDefined();
    expect(failedIntent.detail.error).toContain('只有已审核通过的提现可以打款');

    // 冷却期内不可再申请：把上一笔挪到 25h 前再发。
    await ds.query(
      `UPDATE "withdrawals" SET "created_at" = now() - interval '25 hours' WHERE "id" = $1`,
      [withdrawalId],
    );
    const second = await request(server())
      .post('/api/withdrawals/request')
      .set(auth(token))
      .send({ amountXm: '50' })
      .expect(201);
    expect(await availableOf(user.id)).toBe(200n * XM);

    const rejected = await request(server())
      .post(`/api/admin/withdrawals/${second.body.id}/reject`)
      .set(auth(adminToken))
      .send({ reason: '地址风险' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      id: second.body.id,
      status: 'rejected',
      rejectReason: '地址风险',
    });
    const rejectActions = await adminActions('withdrawal_reject', second.body.id);
    expect(rejectActions).toHaveLength(1);
    expect(rejectActions[0].detail).toMatchObject({
      intent: false,
      status: 'rejected',
      reason: '地址风险',
    });
    expect(await availableOf(user.id)).toBe(250n * XM);
  });

  it('充值认领：按 userAddress 找用户入账；找不到 404；重复认领 400', async () => {
    const user = await makeUser();
    const makeDeposit = async (): Promise<Deposit> => {
      const deposit = await ds.getRepository(Deposit).save(
        ds.getRepository(Deposit).create({
          txHash: `0x${randomUUID().replace(/-/g, '')}`,
          logIndex: 0,
          fromAddress: randomAddress(),
          toAddress: '0x000000000000000000000000000000000000dead',
          rawAmountWei: '50000000000000000000',
          amountMicro: 50n * XM,
          userId: null,
          status: 'unmatched',
          blockNumber: 1n,
        }),
      );
      createdDepositIds.push(deposit.id);
      return deposit;
    };

    const deposit = await makeDeposit();
    const queue = await request(server())
      .get('/api/admin/deposits?status=unmatched')
      .set(auth(adminToken))
      .expect(200);
    expect((queue.body as any[]).some((row) => row.id === deposit.id)).toBe(true);

    const claimed = await request(server())
      .post(`/api/admin/deposits/${deposit.id}/claim`)
      .set(auth(adminToken))
      .send({ userAddress: user.address })
      .expect(200);
    expect(claimed.body).toMatchObject({
      id: deposit.id,
      userId: user.id,
      status: 'credited',
      amount: '50',
    });
    expect(await availableOf(user.id)).toBe(50n * XM);
    const claimActions = await adminActions('deposit_claim', deposit.id);
    expect(claimActions).toHaveLength(1);
    expect(claimActions[0].detail).toMatchObject({
      intent: false,
      status: 'credited',
      userId: user.id,
    });

    // 重复认领 → 400。
    await request(server())
      .post(`/api/admin/deposits/${deposit.id}/claim`)
      .set(auth(adminToken))
      .send({ userAddress: user.address })
      .expect(400);

    // 用户不存在 → 404。
    const orphan = await makeDeposit();
    await request(server())
      .post(`/api/admin/deposits/${orphan.id}/claim`)
      .set(auth(adminToken))
      .send({ userAddress: randomAddress() })
      .expect(404);

    // 地址与 userId 均缺失 → 400。
    await request(server())
      .post(`/api/admin/deposits/${orphan.id}/claim`)
      .set(auth(adminToken))
      .send({})
      .expect(400);
  });

  it('人工队列聚合：manual job / 申诉 / manual_reasons；resolve-delivery 与 retry', async () => {
    // ---- slot1：核验上游反复失败 → job manual + slot manual_reasons ----
    const merchant1 = await makeUser();
    await bindX(merchant1.id);
    await fund(merchant1.id, 10_000n * XM);
    const merchant1Token = await signToken(merchant1);
    const order1 = await makeOrder(merchant1Token, { priceXm: '100', slots: 1 });

    const taker1 = await makeTaker();
    const taker1Token = await signToken(taker1.user);
    const slot1 = (await take(taker1Token, order1).expect(201)).body;

    await deliver(taker1Token, slot1.id, tweetUrl(taker1.binding.handle)).expect(200);

    let now = new Date();
    for (let i = 0; i < 4; i += 1) {
      await scheduler.tick(now);
      now = new Date(now.getTime() + 11 * 60 * 1000);
    }
    const job = await ds.getRepository(VerificationJob).findOneOrFail({
      where: { type: 'delivery', refId: slot1.id },
    });
    expect(job.status).toBe('manual');
    expect((await loadSlot(slot1.id)).manualReasons).toContain('verification_manual');

    // ---- slot2：驳回后申诉（appeal_requested） ----
    const merchant2 = await makeUser();
    await bindX(merchant2.id);
    await fund(merchant2.id, 10_000n * XM);
    const merchant2Token = await signToken(merchant2);
    const order2 = await makeOrder(merchant2Token, { priceXm: '100', slots: 1 });

    const taker2 = await makeTaker();
    const taker2Token = await signToken(taker2.user);
    const slot2 = (await take(taker2Token, order2).expect(201)).body;
    await deliver(taker2Token, slot2.id, tweetUrl(taker2.binding.handle)).expect(200);

    fakeScraper.getTweet.mockRejectedValueOnce(new XNotFoundError('推文不可见'));
    await scheduler.tick(new Date());
    expect((await loadSlot(slot2.id)).status).toBe('reserved');
    await request(server())
      .post(`/api/slots/${slot2.id}/appeal`)
      .set(auth(taker2Token))
      .expect(200);

    // ---- slot3：存活复检/放款人工原因（聚合口径） ----
    const merchant3 = await makeUser();
    await bindX(merchant3.id);
    await fund(merchant3.id, 10_000n * XM);
    const merchant3Token = await signToken(merchant3);
    const order3 = await makeOrder(merchant3Token, { priceXm: '100', slots: 1 });
    const taker3 = await makeTaker();
    const taker3Token = await signToken(taker3.user);
    const slot3 = (await take(taker3Token, order3).expect(201)).body;
    await ds.query(
      `UPDATE "order_slots" SET "manual_reasons" = '["survival_failed"]'::jsonb WHERE "id" = $1`,
      [slot3.id],
    );

    const queue = await request(server())
      .get('/api/admin/manual-queue')
      .set(auth(adminToken))
      .expect(200);

    expect((queue.body.jobs as any[]).some((row) => row.id === job.id)).toBe(true);
    expect((queue.body.appeals as any[]).some((row) => row.id === slot2.id)).toBe(true);
    const manualSlots = queue.body.slots as any[];
    const slot1View = manualSlots.find((row) => row.id === slot1.id);
    expect(slot1View.manualReasons).toContain('verification_manual');
    expect(slot1View.order).toMatchObject({ id: order1, title: 'Admin 抽查商单' });
    expect(manualSlots.some((row) => row.id === slot3.id)).toBe(true);

    // ---- 人工放行：verifying → passed + survival_override + 清人工标记 ----
    const resolved = await request(server())
      .post(`/api/admin/slots/${slot1.id}/resolve-delivery`)
      .set(auth(adminToken))
      .send({ pass: true })
      .expect(200);
    expect(resolved.body.status).toBe('passed');
    const passedSlot = await loadSlot(slot1.id);
    expect(passedSlot.status).toBe('passed');
    expect(passedSlot.survivalOverride).toBe(true);
    expect(passedSlot.manualReasons).toEqual([]);
    expect(passedSlot.appealRequested).toBe(false);
    const resolveActions = await adminActions('slot_resolve_delivery', slot1.id);
    expect(resolveActions).toHaveLength(1);
    expect(resolveActions[0].detail).toMatchObject({
      intent: false,
      status: 'passed',
      pass: true,
    });

    // ---- 申诉放行：reserved+appeal → 人工通过 ----
    const appealResolved = await request(server())
      .post(`/api/admin/slots/${slot2.id}/resolve-delivery`)
      .set(auth(adminToken))
      .send({ pass: true })
      .expect(200);
    expect(appealResolved.body.status).toBe('passed');
    const appealedSlot = await loadSlot(slot2.id);
    expect(appealedSlot.survivalOverride).toBe(true);
    expect(appealedSlot.appealRequested).toBe(false);
    expect(appealedSlot.manualReasons).toEqual([]);
    const appealActions = await adminActions('slot_resolve_delivery', slot2.id);
    expect(appealActions).toHaveLength(1);
    expect(appealActions[0].detail).toMatchObject({
      intent: false,
      status: 'passed',
    });

    // ---- retry：重置 attempts / status / next_run_at / last_error ----
    const retried = await request(server())
      .post(`/api/admin/jobs/${job.id}/retry`)
      .set(auth(adminToken))
      .expect(200);
    expect(retried.body).toMatchObject({
      id: job.id,
      status: 'pending',
      attempts: 0,
      lastError: null,
    });
    const reloaded = await ds.getRepository(VerificationJob).findOneOrFail({
      where: { id: job.id },
    });
    expect(reloaded.status).toBe('pending');
    expect(reloaded.attempts).toBe(0);
    expect(reloaded.lastError).toBeNull();
    expect(Date.now() - reloaded.nextRunAt.getTime()).toBeLessThan(60_000);
    expect(await adminActions('job_retry', job.id)).toHaveLength(1);
  });

  it('争议 HTTP：open 列表 + resolve refund；重复裁决 400；审计落库', async () => {
    const merchant = await makeUser();
    await bindX(merchant.id);
    await fund(merchant.id, 10_000n * XM);
    const merchantToken = await signToken(merchant);
    const orderId = await makeOrder(merchantToken, { priceXm: '100', slots: 1 });

    const taker = await makeTaker();
    const takerToken = await signToken(taker.user);
    const slot = (await take(takerToken, orderId).expect(201)).body;
    await deliver(takerToken, slot.id, tweetUrl(taker.binding.handle)).expect(200);
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(taker.binding.handle, 'passed'));
    await scheduler.tick(new Date());
    expect((await loadSlot(slot.id)).status).toBe('passed');

    const raised = await request(server())
      .post(`/api/slots/${slot.id}/dispute`)
      .set(auth(merchantToken))
      .send({ statement: '交付质量不符合要求' })
      .expect(201);
    const disputeId = raised.body.id;

    const list = await request(server())
      .get('/api/admin/disputes?status=open')
      .set(auth(adminToken))
      .expect(200);
    const view = (list.body as any[]).find((row) => row.id === disputeId);
    expect(view).toMatchObject({
      id: disputeId,
      status: 'open',
      kind: 'quality',
    });
    expect(view.order).toMatchObject({ id: orderId, title: 'Admin 抽查商单' });
    expect(view.slot).toMatchObject({ id: slot.id, creatorUserId: taker.user.id });

    const merchantBefore = await availableOf(merchant.id);
    const resolved = await request(server())
      .post(`/api/admin/disputes/${disputeId}/resolve`)
      .set(auth(adminToken))
      .send({ ruling: 'refund', note: '交付不合格' })
      .expect(200);
    expect(resolved.body).toMatchObject({
      id: disputeId,
      status: 'resolved_refund',
      resolvedBy: admin.id,
    });
    expect((await loadSlot(slot.id)).status).toBe('refunded');
    expect(await availableOf(merchant.id)).toBe(merchantBefore + 100n * XM);
    const resolveActions = await adminActions('dispute_resolve', disputeId);
    expect(resolveActions).toHaveLength(1);
    expect(resolveActions[0].detail).toMatchObject({
      intent: false,
      ruling: 'refund',
      status: 'resolved_refund',
    });

    // 已结案重复裁决 → 400，但失败操作留下 intent=true 审计行。
    await request(server())
      .post(`/api/admin/disputes/${disputeId}/resolve`)
      .set(auth(adminToken))
      .send({ ruling: 'refund', note: '再来一次' })
      .expect(400);
    const resolveActionsAfterFailure = await adminActions(
      'dispute_resolve',
      disputeId,
    );
    expect(resolveActionsAfterFailure).toHaveLength(2);
    const failedResolveIntent = resolveActionsAfterFailure.find(
      (row) => row.detail.intent === true,
    );
    expect(failedResolveIntent).toBeDefined();
    expect(failedResolveIntent.detail.error).toContain('争议已结案');

    // all 也包含已结案。
    const all = await request(server())
      .get('/api/admin/disputes?status=all')
      .set(auth(adminToken))
      .expect(200);
    expect((all.body as any[]).some((row) => row.id === disputeId)).toBe(true);
  });

  it('罚则完整编排：escrow 没收、善意交付按 P 补发、未交付 expired、商家清零+suspend', async () => {
    const merchant = await makeUser();
    await bindX(merchant.id);
    await fund(merchant.id, 100_000n * XM);
    const merchantToken = await signToken(merchant);
    const orderId = await makeOrder(merchantToken, { priceXm: '100', slots: 3 });

    // 商家另有一笔 pending 提现：罚则需先解冻再没收，避免提现行卡死。
    const pendingWithdrawal = await request(server())
      .post('/api/withdrawals/request')
      .set(auth(merchantToken))
      .send({ amountXm: '50' })
      .expect(201);

    // 名额 A：已交付、核验上游反复失败 → 停在 verifying（delivered_at != null）。
    const takerA = await makeTaker();
    const takerAToken = await signToken(takerA.user);
    const slotA = (await take(takerAToken, orderId).expect(201)).body;
    await deliver(takerAToken, slotA.id, tweetUrl(takerA.binding.handle)).expect(200);
    let tickAt = new Date();
    for (let i = 0; i < 4; i += 1) {
      await scheduler.tick(tickAt);
      tickAt = new Date(tickAt.getTime() + 11 * 60 * 1000);
    }
    expect((await loadSlot(slotA.id)).status).toBe('verifying');

    // 名额 B：已抢未交付（reserved）。
    const takerB = await makeTaker();
    const takerBToken = await signToken(takerB.user);
    const slotB = (await take(takerBToken, orderId).expect(201)).body;

    // 名额 C：未产生（自由池仍占 P）。

    const orderBefore = await loadOrder(orderId);
    const escrowBefore = await platformAvailable(PLATFORM_ACCOUNTS.escrow);
    const incomeBefore = await platformAvailable(PLATFORM_ACCOUNTS.income);
    const merchantBefore = await availableOf(merchant.id);
    const totalBefore = await sumAll();
    expect(orderBefore.escrowMicro).toBe(300n * XM);
    // 100000 − (300 + 15 fee) − 50 冻结中的提现
    expect(merchantBefore).toBe(99_635n * XM);

    const res = await request(server())
      .post(`/api/admin/orders/${orderId}/penalize`)
      .set(auth(adminToken))
      .send({ reason: '商家恶意欺诈' })
      .expect(200);
    expect(res.body).toMatchObject({
      id: orderId,
      status: 'closed',
      escrowForfeitedXm: '300',
      merchantForfeitedXm: '99685',
      suspendedUserId: merchant.id,
    });
    expect((res.body.compensated as any[]).map((row) => row.slotId)).toEqual([slotA.id]);
    expect((res.body.expiredSlotIds as string[]).sort()).toEqual([slotB.id].sort());

    // 订单关闭、托管清零。
    const orderAfter = await loadOrder(orderId);
    expect(orderAfter.status).toBe('closed');
    expect(orderAfter.escrowMicro).toBe(0n);
    expect(orderAfter.closedAt).toBeInstanceOf(Date);

    // A：平台按全额 P 补发，名额 refunded。
    const slotAAfter = await loadSlot(slotA.id);
    expect(slotAAfter.status).toBe('refunded');
    expect(await availableOf(takerA.user.id)).toBe(100n * XM);

    // B：未交付 → expired，无补发。
    expect((await loadSlot(slotB.id)).status).toBe('expired');
    expect(await availableOf(takerB.user.id)).toBe(0n);

    // 商家：余额（含提现冻结）清零 + suspended。
    expect(await availableOf(merchant.id)).toBe(0n);
    const merchantAfter = await ds.getRepository(User).findOneOrFail({
      where: { id: merchant.id },
    });
    expect(merchantAfter.status).toBe('suspended');

    // pending 提现被取消并退回（随后一起没收），不会卡在 pending/approved。
    const cancelledWithdrawal = await ds
      .getRepository(Withdrawal)
      .findOneOrFail({ where: { id: pendingWithdrawal.body.id } });
    expect(cancelledWithdrawal.status).toBe('rejected');
    expect(cancelledWithdrawal.rejectReason).toContain('违规');

    // 平台账：escrow −订单托管；income +escrow +商家余额 −补发；系统总额不变。
    expect(await platformAvailable(PLATFORM_ACCOUNTS.escrow)).toBe(
      escrowBefore - 300n * XM,
    );
    expect(await platformAvailable(PLATFORM_ACCOUNTS.income)).toBe(
      incomeBefore + 300n * XM + 99_685n * XM - 100n * XM,
    );
    expect(await sumAll()).toBe(totalBefore);

    // 审计 + 通知受影响 KOL。
    const actions = await adminActions('order_penalize', orderId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      admin_user_id: admin.id,
      target_type: 'order',
      target_id: orderId,
    });
    expect(actions[0].detail).toMatchObject({
      reason: '商家恶意欺诈',
      escrowForfeitedMicro: String(300n * XM),
    });

    const notesA = await ds.getRepository(Notification).find({
      where: { userId: takerA.user.id, kind: 'order_penalized_compensation' },
    });
    expect(notesA).toHaveLength(1);
    const notesB = await ds.getRepository(Notification).find({
      where: { userId: takerB.user.id, kind: 'order_penalized_slot_closed' },
    });
    expect(notesB).toHaveLength(1);

    // 补发流水带 memo。
    const entries = await ds.getRepository(LedgerEntry).find({
      where: { refType: 'order', refId: orderId, kind: 'penalty_compensation' },
    });
    expect(entries.some((entry) => entry.memo === '违规单补发')).toBe(true);

    // 重复罚则 → 400，且不再产生资金动作。
    await request(server())
      .post(`/api/admin/orders/${orderId}/penalize`)
      .set(auth(adminToken))
      .send({ reason: '重复处罚' })
      .expect(400);
    expect(await platformAvailable(PLATFORM_ACCOUNTS.income)).toBe(
      incomeBefore + 300n * XM + 99_685n * XM - 100n * XM,
    );
  });

  it('罚则不碰已 paid 名额：钱已结给接单方，仅没收剩余托管与商家余额', async () => {
    const merchant = await makeUser();
    await bindX(merchant.id);
    await fund(merchant.id, 1_000n * XM);
    const merchantToken = await signToken(merchant);
    const orderId = await makeOrder(merchantToken, { priceXm: '100', slots: 1 });

    const taker = await makeTaker();
    const takerToken = await signToken(taker.user);
    const slot = (await take(takerToken, orderId).expect(201)).body;
    await deliver(takerToken, slot.id, tweetUrl(taker.binding.handle)).expect(200);
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(taker.binding.handle, 'passed'));
    await scheduler.tick(new Date());
    await confirm(merchantToken, slot.id).expect(200);
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(taker.binding.handle, 'alive'));
    await scheduler.tick(new Date());
    expect((await loadSlot(slot.id)).status).toBe('paid');

    expect(await availableOf(taker.user.id)).toBe(95n * XM);
    const orderBefore = await loadOrder(orderId);
    expect(orderBefore.escrowMicro).toBe(0n);
    const merchantBefore = await availableOf(merchant.id);
    const incomeBefore = await platformAvailable(PLATFORM_ACCOUNTS.income);

    const res = await request(server())
      .post(`/api/admin/orders/${orderId}/penalize`)
      .set(auth(adminToken))
      .send({ reason: '售后违规' })
      .expect(200);
    expect(res.body.escrowForfeitedXm).toBe('0');
    expect(res.body.compensated).toEqual([]);

    // paid 名额原封不动，接单方已到手金额不变。
    expect((await loadSlot(slot.id)).status).toBe('paid');
    expect(await availableOf(taker.user.id)).toBe(95n * XM);
    expect(
      await ds
        .getRepository(LedgerEntry)
        .count({ where: { refType: 'order', refId: orderId, kind: 'penalty_compensation' } }),
    ).toBe(0);

    // 商家可用余额全额没收。
    expect(await availableOf(merchant.id)).toBe(0n);
    expect(await platformAvailable(PLATFORM_ACCOUNTS.income)).toBe(
      incomeBefore + merchantBefore,
    );
    expect(
      (await ds.getRepository(User).findOneOrFail({ where: { id: merchant.id } })).status,
    ).toBe('suspended');
  });

  it('罚则补发口径：已交付但被打回后超时的 expired 名额同样补发', async () => {
    const merchant = await makeUser();
    await bindX(merchant.id);
    await fund(merchant.id, 1_000n * XM);
    const merchantToken = await signToken(merchant);
    const orderId = await makeOrder(merchantToken, { priceXm: '100', slots: 1 });

    const taker = await makeTaker();
    const takerToken = await signToken(taker.user);
    const slot = (await take(takerToken, orderId).expect(201)).body;
    await deliver(takerToken, slot.id, tweetUrl(taker.binding.handle)).expect(200);

    // 交付被打回（delivered_at 保留）→ 超时 → expired。
    fakeScraper.getTweet.mockRejectedValueOnce(new XNotFoundError('推文不可见'));
    await scheduler.tick(new Date());
    expect((await loadSlot(slot.id)).status).toBe('reserved');
    expect((await loadSlot(slot.id)).deliveredAt).toBeInstanceOf(Date);

    await ds.query(
      `UPDATE "order_slots" SET "deliver_deadline_at" = now() - interval '1 minute' WHERE "id" = $1`,
      [slot.id],
    );
    await slotsService.expireOverdue(new Date());
    const expired = await loadSlot(slot.id);
    expect(expired.status).toBe('expired');
    expect(expired.deliveredAt).toBeInstanceOf(Date);

    const res = await request(server())
      .post(`/api/admin/orders/${orderId}/penalize`)
      .set(auth(adminToken))
      .send({ reason: '商家违规' })
      .expect(200);

    // delivered_at != null 且非 paid/refunded → 补偿；已 expired 不属于本次置 expired 列表。
    expect((res.body.compensated as any[]).map((row) => row.slotId)).toEqual([
      slot.id,
    ]);
    expect(res.body.expiredSlotIds).toEqual([]);
    expect((await loadSlot(slot.id)).status).toBe('refunded');
    expect(await availableOf(taker.user.id)).toBe(100n * XM);
  });

  it('用户管理：搜索 / suspend 后 JWT 全端点 401 / unsuspend 恢复；均审计', async () => {
    const user = await makeUser();
    const binding = await bindX(user.id);
    const token = await signToken(user);

    // 搜索：地址 / nickname / X handle。
    const byAddress = await request(server())
      .get(`/api/admin/users?q=${user.address}`)
      .set(auth(adminToken))
      .expect(200);
    expect((byAddress.body.items as any[]).some((row) => row.id === user.id)).toBe(true);

    const byHandle = await request(server())
      .get(`/api/admin/users?q=${binding.handle}`)
      .set(auth(adminToken))
      .expect(200);
    const handleRow = (byHandle.body.items as any[]).find((row) => row.id === user.id);
    expect(handleRow).toMatchObject({ xHandle: binding.handle });

    await request(server()).get('/api/auth/me').set(auth(token)).expect(200);

    const suspended = await request(server())
      .post(`/api/admin/users/${user.id}/suspend`)
      .set(auth(adminToken))
      .expect(200);
    expect(suspended.body).toMatchObject({ id: user.id, status: 'suspended' });
    expect(await adminActions('user_suspend', user.id)).toHaveLength(1);

    // 封禁即时生效：同一 JWT 访问任意受保护端点 → 401。
    await request(server()).get('/api/auth/me').set(auth(token)).expect(401);
    await request(server()).get('/api/withdrawals/mine').set(auth(token)).expect(401);

    // 状态搜索。
    const suspendedList = await request(server())
      .get('/api/admin/users?q=suspended')
      .set(auth(adminToken))
      .expect(200);
    expect(
      (suspendedList.body.items as any[]).some(
        (row) => row.id === user.id && row.status === 'suspended',
      ),
    ).toBe(true);

    const unsuspended = await request(server())
      .post(`/api/admin/users/${user.id}/unsuspend`)
      .set(auth(adminToken))
      .expect(200);
    expect(unsuspended.body).toMatchObject({ id: user.id, status: 'active' });
    expect(await adminActions('user_unsuspend', user.id)).toHaveLength(1);

    await request(server()).get('/api/auth/me').set(auth(token)).expect(200);
  });

  it('抽查：订单列表（q=标题/商家地址/单号）与全量详情', async () => {
    const merchant = await makeUser();
    await bindX(merchant.id);
    await fund(merchant.id, 10_000n * XM);
    const merchantToken = await signToken(merchant);
    const title = `抽查专用单-${randomUUID().slice(0, 8)}`;
    const orderId = await makeOrder(merchantToken, {
      priceXm: '100',
      slots: 1,
      title,
    });

    const taker = await makeTaker();
    const takerToken = await signToken(taker.user);
    const slot = (await take(takerToken, orderId).expect(201)).body;
    await deliver(takerToken, slot.id, tweetUrl(taker.binding.handle)).expect(200);
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(taker.binding.handle, 'snap'));
    await scheduler.tick(new Date());

    for (const q of [title, merchant.address, orderId.slice(0, 8)]) {
      const res = await request(server())
        .get(`/api/admin/orders?q=${encodeURIComponent(q)}&type=post&status=recruiting&page=1`)
        .set(auth(adminToken))
        .expect(200);
      expect((res.body.items as any[]).some((row) => row.id === orderId)).toBe(true);
      expect(res.body.page).toBe(1);
    }

    const detail = await request(server())
      .get(`/api/admin/orders/${orderId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(detail.body).toMatchObject({
      id: orderId,
      title,
      priceXm: '100',
      escrowXm: '100',
      status: 'recruiting',
    });
    expect(detail.body.merchant).toMatchObject({
      id: merchant.id,
      address: merchant.address,
    });
    expect(detail.body.slots).toHaveLength(1);
    const slotView = detail.body.slots[0];
    expect(slotView).toMatchObject({
      id: slot.id,
      status: 'passed',
      creatorUserId: taker.user.id,
    });
    expect(slotView.deliveryUrl).toContain('/status/');
    expect(slotView.verifySnapshot).toBeTruthy();
    expect(slotView.verifySnapshot.text).toBe('snap');
    expect(Array.isArray(detail.body.disputes)).toBe(true);
  });

  it('改绑审核：pending 列表、approve、reject；每步审计', async () => {
    const user = await makeUser();
    const makeChange = async (kind: 'wallet' | 'x') =>
      ds.getRepository(BindingChange).save(
        ds.getRepository(BindingChange).create({
          userId: user.id,
          kind,
          newValue: kind === 'wallet' ? randomAddress() : `new${handleSeq++}`,
          status: 'pending',
          effectiveAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          appliedAt: null,
        }),
      );

    const approvedChange = await makeChange('wallet');
    const pendingList = await request(server())
      .get('/api/admin/binding-changes?status=pending')
      .set(auth(adminToken))
      .expect(200);
    const listed = (pendingList.body as any[]).find(
      (row) => row.id === approvedChange.id,
    );
    expect(listed).toMatchObject({ kind: 'wallet', status: 'pending' });
    expect(listed.user).toMatchObject({ id: user.id, address: user.address });

    const approved = await request(server())
      .post(`/api/admin/binding-changes/${approvedChange.id}/approve`)
      .set(auth(adminToken))
      .expect(200);
    expect(approved.body).toMatchObject({ id: approvedChange.id, status: 'approved' });
    expect(await adminActions('binding_change_approve', approvedChange.id)).toHaveLength(1);

    // 非 pending 再批 → 400。
    await request(server())
      .post(`/api/admin/binding-changes/${approvedChange.id}/approve`)
      .set(auth(adminToken))
      .expect(400);

    const rejectedChange = await makeChange('x');
    const rejected = await request(server())
      .post(`/api/admin/binding-changes/${rejectedChange.id}/reject`)
      .set(auth(adminToken))
      .send({ reason: '目标账号存在争议' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      id: rejectedChange.id,
      status: 'rejected',
    });
    expect(await adminActions('binding_change_reject', rejectedChange.id)).toHaveLength(1);
  });
});
