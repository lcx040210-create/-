import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { PLATFORM_ACCOUNTS } from '../src/database/migrations/1700000003000-ledger';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { VerificationJob } from '../src/jobs/verification-job.entity';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { Notification } from '../src/notifications/notification.entity';
import { Order } from '../src/orders/order.entity';
import { Referral } from '../src/referral/referral.entity';
import { SettlementService } from '../src/settlement/settlement.service';
import { OrderSlot } from '../src/slots/order-slot.entity';
import { User } from '../src/users/user.entity';
import {
  XNotFoundError,
  XScraperService,
  XUpstreamError,
} from '../src/xscraper/xscraper.service';
import { XTweet } from '../src/xscraper/xscraper.types';

const XM = MICRO;
const HOUR_MS = 60 * 60 * 1000;

const fakeScraper = {
  getTweet: jest.fn(),
  getProfile: jest.fn(),
  getRecentTweets: jest.fn(),
};

describe('结算 / 确认 / 48h 自动放款 / 存活复检 / 订单到期 e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let scheduler: SchedulerService;
  let settlement: SettlementService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];
  let handleSeq = 0;
  let tweetSeq = 0;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: 'active',
        role: 'user',
        nickname: null,
        ratingGrade: null,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function bindX(userId: string): Promise<XBinding> {
    const handle = `u${randomUUID().replace(/-/g, '').slice(0, 10)}${handleSeq++}`.slice(0, 15);
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

  async function makeTaker(): Promise<{ user: User; binding: XBinding }> {
    const user = await makeUser();
    const binding = await bindX(user.id);
    return { user, binding };
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

  const escrowAvailable = () => platformAvailable(PLATFORM_ACCOUNTS.escrow);
  const incomeAvailable = () => platformAvailable(PLATFORM_ACCOUNTS.income);

  async function signToken(user: User): Promise<string> {
    return jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: process.env.JWT_SECRET, expiresIn: '1h' },
    );
  }

  async function makeOrder(
    opts: {
      priceXm?: string;
      slots?: number;
      requirements?: Record<string, unknown>;
    } = {},
  ): Promise<{ merchant: User; token: string; orderId: string }> {
    const merchant = await makeUser();
    await bindX(merchant.id);
    await fund(merchant.id, 100_000n * XM);
    const token = await signToken(merchant);
    const res = await request(server())
      .post('/api/orders')
      .set(auth(token))
      .send({
        type: 'post',
        title: '结算测试商单',
        brief: '结算测试说明',
        requirements: {
          keywords: [],
          hashtags: [],
          mentions: [],
          links: [],
          ...opts.requirements,
        },
        priceXm: opts.priceXm ?? '100',
        slots: opts.slots ?? 1,
      })
      .expect(201);
    return { merchant, token, orderId: res.body.id as string };
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
    return `https://x.com/${handle}/status/${Date.now()}${tweetSeq}`;
  }

  function makeTweet(handle: string, text = 'settlement tweet'): XTweet {
    tweetSeq += 1;
    return {
      id: String(1770000000000000000n + BigInt(tweetSeq)),
      url: `https://x.com/${handle}/status/${1770000000000000000n + BigInt(tweetSeq)}`,
      created_at: new Date().toISOString(),
      author: { handle, name: handle },
      text,
    };
  }

  const loadSlot = (id: string) =>
    ds.getRepository(OrderSlot).findOneOrFail({ where: { id } });
  const loadOrder = (id: string) =>
    ds.getRepository(Order).findOneOrFail({ where: { id } });

  const jobsOf = (slotId: string, type: string) =>
    ds.getRepository(VerificationJob).find({
      where: { type, refId: slotId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

  const notificationsFor = (userId: string, kind?: string) =>
    ds.getRepository(Notification).find({
      where: kind ? { userId, kind } : { userId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

  async function setSlotConfirmDeadline(slotId: string, at: Date): Promise<void> {
    await ds.query(
      `UPDATE "order_slots" SET "confirmed_deadline_at" = $1 WHERE "id" = $2`,
      [at, slotId],
    );
  }

  async function setOrderExpiry(orderId: string, at: Date): Promise<void> {
    await ds.query(`UPDATE "orders" SET "expires_at" = $1 WHERE "id" = $2`, [at, orderId]);
  }

  /** 建单 → 抢单 → 交付 → 核验通过（passed，48h 确认窗）。 */
  async function makePassedSlot(
    opts: { priceXm?: string; slots?: number } = {},
  ): Promise<{
    merchant: User;
    merchantToken: string;
    taker: User;
    takerToken: string;
    binding: XBinding;
    orderId: string;
    slotId: string;
  }> {
    const { merchant, token: merchantToken, orderId } = await makeOrder(opts);
    const { user: taker, binding } = await makeTaker();
    const takerToken = await signToken(taker);
    const slot = (await take(takerToken, orderId).expect(201)).body;
    await deliver(takerToken, slot.id, tweetUrl(binding.handle)).expect(200);

    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(binding.handle, 'passed'));
    await scheduler.tick();

    const row = await loadSlot(slot.id);
    expect(row.status).toBe('passed');
    return {
      merchant,
      merchantToken,
      taker,
      takerToken,
      binding,
      orderId,
      slotId: slot.id,
    };
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
    settlement = app.get(SettlementService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(VerificationJob).delete({ type: 'delivery' });
      await ds.getRepository(VerificationJob).delete({ type: 'payout' });
      if (createdUserIds.length) {
        await ds.getRepository(Order).delete({ merchantUserId: In(createdUserIds) });
        await ds.getRepository(Notification).delete({ userId: In(createdUserIds) });
        await ds.getRepository(Referral).delete({ inviteeUserId: In(createdUserIds) });
        await ds.getRepository(Referral).delete({ referrerUserId: In(createdUserIds) });
        await ds.getRepository(XBinding).delete({ userId: In(createdUserIds) });
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
    await app.close();
  });

  beforeEach(async () => {
    // 隔离队列与遗留名额，避免上一个用例的 passed/verifying 被本用例的扫描拾取。
    await ds.getRepository(VerificationJob).delete({ type: 'delivery' });
    await ds.getRepository(VerificationJob).delete({ type: 'payout' });
    await ds.query(
      `UPDATE "order_slots"
          SET "status" = 'expired'
        WHERE "status" IN ('verifying', 'passed', 'reserved')`,
    );
    fakeScraper.getTweet.mockReset();
    fakeScraper.getTweet.mockRejectedValue(new XUpstreamError('fake: 未排队的推文'));
    fakeScraper.getProfile.mockReset();
    fakeScraper.getRecentTweets.mockReset();
  });

  it('商家确认 → 放款数学：creator 95、income 5（P=100）、escrow −100、不变量保持', async () => {
    const { merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    const escrowBefore = await escrowAvailable();
    const incomeBefore = await incomeAvailable();

    const res = await confirm(merchantToken, slotId).expect(200);
    expect(res.body).toMatchObject({ id: slotId, status: 'passed', queued: true });

    const payoutJobs = await jobsOf(slotId, 'payout');
    expect(payoutJobs).toHaveLength(1);
    expect(payoutJobs[0]).toMatchObject({ status: 'pending', attempts: 0, payload: {} });

    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet('creator', 'still alive'));
    await scheduler.tick();

    const row = await loadSlot(slotId);
    expect(row.status).toBe('paid');
    expect(row.settledAt).toBeInstanceOf(Date);

    // 放款数学：payout = 100 − pctFloor(100, 5, 100) = 95；completion fee = 5。
    expect(await availableOf(taker.id)).toBe(95n * XM);
    expect(await escrowAvailable()).toBe(escrowBefore - 100n * XM);
    expect(await incomeAvailable()).toBe(incomeBefore + 5n * XM);

    const order = await loadOrder(row.orderId);
    expect(order.escrowMicro).toBe(0n);
    expect(order.status).toBe('completed');

    // 流水：slot_payout 与 completion_fee 各两条（转出 / 转入）。
    const entries = await ds.getRepository(LedgerEntry).find({
      where: { refType: 'slot', refId: slotId },
    });
    expect(entries.filter((entry) => entry.kind === 'slot_payout')).toHaveLength(2);
    expect(entries.filter((entry) => entry.kind === 'completion_fee')).toHaveLength(2);

    // 重复确认幂等：已 paid 不再入队。
    const again = await confirm(merchantToken, slotId).expect(200);
    expect(again.body).toMatchObject({ id: slotId, status: 'paid', queued: false });
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);
  });

  it('48h 到期无动作 → cron 自动确认并放款', async () => {
    const { taker, slotId } = await makePassedSlot({ priceXm: '100', slots: 1 });

    // 未到期：不扫描。
    const early = await settlement.sweep();
    expect(early.payouts).toBe(0);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(0);

    await setSlotConfirmDeadline(slotId, new Date(Date.now() - 1_000));
    const result = await settlement.sweep();
    expect(result.payouts).toBe(1);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);

    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet('creator', 'still alive'));
    await scheduler.tick();

    const row = await loadSlot(slotId);
    expect(row.status).toBe('paid');
    expect(row.settledAt).toBeInstanceOf(Date);
    expect(await availableOf(taker.id)).toBe(95n * XM);
    expect((await loadOrder(row.orderId)).escrowMicro).toBe(0n);
  });

  it('商家先确认、cron 再到 → 只放一次（幂等）', async () => {
    const { merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });

    const first = await confirm(merchantToken, slotId).expect(200);
    expect(first.body.queued).toBe(true);
    const second = await confirm(merchantToken, slotId).expect(200);
    expect(second.body.queued).toBe(false);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);

    await setSlotConfirmDeadline(slotId, new Date(Date.now() - 1_000));
    const swept = await settlement.sweep();
    expect(swept.payouts).toBe(0); // 已有 pending payout job，不重复入队
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);

    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet('creator', 'alive'));
    await scheduler.tick();
    await scheduler.tick(new Date(Date.now() + 60_000));

    expect((await loadSlot(slotId)).status).toBe('paid');
    expect(await availableOf(taker.id)).toBe(95n * XM); // 只放一次
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);
  });

  it('并发确认：同 slot 至多一个 pending payout job', async () => {
    const { merchantToken, slotId } = await makePassedSlot({ priceXm: '100', slots: 1 });

    const [first, second] = await Promise.all([
      confirm(merchantToken, slotId),
      confirm(merchantToken, slotId),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect([first.body.queued, second.body.queued].sort()).toEqual([false, true]);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);
  });

  it('存活复检：推已删 → 不放款、名额进人工（verifying + survival_failed）、商家收通知', async () => {
    const { merchant, merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    const escrowBefore = await escrowAvailable();

    await confirm(merchantToken, slotId).expect(200);
    fakeScraper.getTweet.mockRejectedValueOnce(new XNotFoundError('没找到推文'));
    await scheduler.tick();

    const row = await loadSlot(slotId);
    expect(row.status).toBe('verifying');
    expect(row.settledAt).toBeNull();
    expect(row.manualReasons).toContain('survival_failed');

    // 未动钱：接单方无入账、escrow 不变、订单仍在托管。
    expect(await availableOf(taker.id)).toBe(0n);
    expect(await escrowAvailable()).toBe(escrowBefore);
    expect((await loadOrder(row.orderId)).escrowMicro).toBe(100n * XM);

    const job = (await jobsOf(slotId, 'payout'))[0];
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(1);

    const notes = await notificationsFor(merchant.id, 'slot_survival_failed');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ refType: 'slot', refId: slotId });
    expect(notes[0].body).toContain('人工');

    // 转人工后 cron 不再自动放款（不再是 passed），商家也不能再确认。
    expect((await settlement.sweep()).payouts).toBe(0);
    const rejected = await confirm(merchantToken, slotId).expect(400);
    expect(rejected.body.message).toBeTruthy();
  });

  it('争议与自动放款竞态：事务锁内复核 status=passed，挡掉放款', async () => {
    const { merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    const escrowBefore = await escrowAvailable();
    await confirm(merchantToken, slotId).expect(200);

    // 存活复检期间被 T15 争议流程改为 disputed（模拟竞态）。
    fakeScraper.getTweet.mockImplementationOnce(async () => {
      await ds.query(`UPDATE "order_slots" SET "status" = 'disputed' WHERE "id" = $1`, [slotId]);
      return makeTweet('creator', 'alive');
    });
    await scheduler.tick();

    const row = await loadSlot(slotId);
    expect(row.status).toBe('disputed');
    expect(row.settledAt).toBeNull();
    expect(await availableOf(taker.id)).toBe(0n);
    expect(await escrowAvailable()).toBe(escrowBefore);
    expect((await loadOrder(row.orderId)).escrowMicro).toBe(100n * XM);
  });

  it('上游错误 → job 退避（attempts+1）不卡死，恢复后正常放款', async () => {
    const { merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    await confirm(merchantToken, slotId).expect(200);

    fakeScraper.getTweet.mockRejectedValueOnce(new XUpstreamError('boom'));
    const t0 = new Date();
    await scheduler.tick(t0);

    let job = (await jobsOf(slotId, 'payout'))[0];
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.nextRunAt.getTime()).toBe(t0.getTime() + 60_000);
    expect(job.lastError).toContain('boom');
    expect((await loadSlot(slotId)).status).toBe('passed');
    expect(await availableOf(taker.id)).toBe(0n);

    // 上游恢复：到点重试成功。
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet('creator', 'recovered'));
    await scheduler.tick(new Date(t0.getTime() + 60_001));

    job = (await jobsOf(slotId, 'payout'))[0];
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(2);
    expect((await loadSlot(slotId)).status).toBe('paid');
    expect(await availableOf(taker.id)).toBe(95n * XM);
  });

  it('上游连续失败 4 次 → job manual、名额转人工，cron 不再重复入队', async () => {
    const { merchant, merchantToken, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    const escrowBefore = await escrowAvailable();
    await confirm(merchantToken, slotId).expect(200);

    // beforeEach 的默认 fake 一直拒绝（XUpstreamError）。
    let now = new Date();
    await scheduler.tick(now);
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      const job = (await jobsOf(slotId, 'payout'))[0];
      now = new Date(job.nextRunAt.getTime() + 1_000);
      await scheduler.tick(now);
    }

    const job = (await jobsOf(slotId, 'payout'))[0];
    expect(job.status).toBe('manual');
    expect(job.attempts).toBe(4);

    const row = await loadSlot(slotId);
    expect(row.status).toBe('verifying');
    expect(row.manualReasons).toContain('payout_manual');
    expect(await escrowAvailable()).toBe(escrowBefore);

    // 名额已非 passed：到点 cron 不再重复入队，避免死循环。
    await setSlotConfirmDeadline(slotId, new Date(Date.now() - 1_000));
    expect((await settlement.sweep()).payouts).toBe(0);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);

    const notes = await notificationsFor(merchant.id, 'slot_payout_manual');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ refType: 'slot', refId: slotId });
  });

  it('订单到期：自由池退款；从未被接的订单全额退含 fee', async () => {
    // A. 已被接：fee 已赚，只退自由池（2 名额 − 1 活跃 = 1 × P）。
    const a = await makeOrder({ priceXm: '100', slots: 2 });
    const takerA = await makeTaker();
    await take(await signToken(takerA.user), a.orderId).expect(201);

    const merchantBeforeA = await availableOf(a.merchant.id);
    const escrowBeforeA = await escrowAvailable();
    await setOrderExpiry(a.orderId, new Date(Date.now() - 1_000));

    const sweptA = await settlement.sweep();
    expect(sweptA.closedOrders).toBe(1);

    const orderA = await loadOrder(a.orderId);
    expect(orderA.status).toBe('closed');
    expect(orderA.closedAt).toBeInstanceOf(Date);
    expect(orderA.escrowMicro).toBe(100n * XM); // 活跃名额仍占用 1 × P
    expect(await availableOf(a.merchant.id)).toBe(merchantBeforeA + 100n * XM);
    expect(await escrowAvailable()).toBe(escrowBeforeA - 100n * XM);

    // 再次扫描：已 closed，不重复退款。
    expect((await settlement.sweep()).closedOrders).toBe(0);
    expect(await availableOf(a.merchant.id)).toBe(merchantBeforeA + 100n * XM);

    // B. 从未被接：fee 未赚，全额退（2 × P + fee）。
    const b = await makeOrder({ priceXm: '100', slots: 2 });
    const merchantBeforeB = await availableOf(b.merchant.id);
    const escrowBeforeB = await escrowAvailable();
    await setOrderExpiry(b.orderId, new Date(Date.now() - 1_000));

    expect((await settlement.sweep()).closedOrders).toBe(1);

    const orderB = await loadOrder(b.orderId);
    expect(orderB.status).toBe('closed');
    expect(orderB.feeEarned).toBe(false);
    expect(orderB.escrowMicro).toBe(0n);
    // 建单冻结 200 + fee 10，到期全额退回。
    expect(await availableOf(b.merchant.id)).toBe(merchantBeforeB + 210n * XM);
    expect(await escrowAvailable()).toBe(escrowBeforeB - 210n * XM);
    expect(merchantBeforeB + 210n * XM).toBe(100_000n * XM);
  });

  it('全部名额终态 → order.completed；中途仍有活跃名额则保持 recruiting', async () => {
    const { token: merchantToken, orderId } = await makeOrder({
      priceXm: '100',
      slots: 2,
    });
    const takerA = await makeTaker();
    const takerB = await makeTaker();
    const tokenA = await signToken(takerA.user);
    const tokenB = await signToken(takerB.user);

    const slotA = (await take(tokenA, orderId).expect(201)).body;
    const slotB = (await take(tokenB, orderId).expect(201)).body;
    await deliver(tokenA, slotA.id, tweetUrl(takerA.binding.handle)).expect(200);
    await deliver(tokenB, slotB.id, tweetUrl(takerB.binding.handle)).expect(200);

    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(takerA.binding.handle));
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(takerB.binding.handle));
    await scheduler.tick();
    expect((await loadSlot(slotA.id)).status).toBe('passed');
    expect((await loadSlot(slotB.id)).status).toBe('passed');

    // 只确认一个：仍有活跃名额，订单不得 completed。
    await confirm(merchantToken, slotA.id).expect(200);
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(takerA.binding.handle));
    await scheduler.tick();
    expect((await loadSlot(slotA.id)).status).toBe('paid');
    let order = await loadOrder(orderId);
    expect(order.status).toBe('recruiting');
    expect(order.escrowMicro).toBe(100n * XM);

    // 第二个也放款：无活跃名额且 escrow=0 → completed。
    await confirm(merchantToken, slotB.id).expect(200);
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(takerB.binding.handle));
    await scheduler.tick();
    expect((await loadSlot(slotB.id)).status).toBe('paid');
    order = await loadOrder(orderId);
    expect(order.status).toBe('completed');
    expect(order.escrowMicro).toBe(0n);

    expect(await availableOf(takerA.user.id)).toBe(95n * XM);
    expect(await availableOf(takerB.user.id)).toBe(95n * XM);
  });
});
