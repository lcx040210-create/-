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
import { Dispute } from '../src/disputes/dispute.entity';
import { DisputesService } from '../src/disputes/disputes.service';
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
import { VerificationService } from '../src/verification/verification.service';
import {
  XNotFoundError,
  XScraperService,
  XUpstreamError,
} from '../src/xscraper/xscraper.service';
import { XTweet } from '../src/xscraper/xscraper.types';

const XM = MICRO;
const DAY_MS = 24 * 60 * 60 * 1000;

const fakeScraper = {
  getTweet: jest.fn(),
  getProfile: jest.fn(),
  getRecentTweets: jest.fn(),
};

describe('争议（商家申诉 / 人工裁决 / 删帖追回）e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let scheduler: SchedulerService;
  let settlement: SettlementService;
  let disputes: DisputesService;
  let verification: VerificationService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];
  let handleSeq = 0;
  let tweetSeq = 0;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(role: 'user' | 'admin' = 'user'): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: 'active',
        role,
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

  async function signToken(user: User): Promise<string> {
    return jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: process.env.JWT_SECRET, expiresIn: '1h' },
    );
  }

  async function makeOrder(
    opts: { priceXm?: string; slots?: number } = {},
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
        title: '争议测试商单',
        brief: '争议测试说明',
        requirements: {
          keywords: [],
          hashtags: [],
          mentions: [],
          links: [],
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

  const raiseDispute = (token: string, slotId: string, statement = '交付质量不符合要求') =>
    request(server())
      .post(`/api/slots/${slotId}/dispute`)
      .set(auth(token))
      .send({ statement });

  const reportDeletion = (token: string, slotId: string, statement = '商家已删除推文') =>
    request(server())
      .post(`/api/slots/${slotId}/report-deletion`)
      .set(auth(token))
      .send({ statement });

  const respond = (token: string, disputeId: string, statement: string) =>
    request(server())
      .post(`/api/disputes/${disputeId}/respond`)
      .set(auth(token))
      .send({ statement });

  function tweetUrl(handle: string): string {
    tweetSeq += 1;
    return `https://x.com/${handle}/status/${Date.now()}${tweetSeq}`;
  }

  function makeTweet(handle: string, text = 'dispute tweet'): XTweet {
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
  const loadDispute = (id: string) =>
    ds.getRepository(Dispute).findOneOrFail({ where: { id } });

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

  async function setSlotSettledAt(slotId: string, at: Date): Promise<void> {
    await ds.query(`UPDATE "order_slots" SET "settled_at" = $1 WHERE "id" = $2`, [
      at,
      slotId,
    ]);
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

  /** passed → 商家确认 → 放款完成（paid，creator 到手 95）。 */
  async function makePaidSlot(
    opts: { priceXm?: string; slots?: number } = {},
  ): Promise<Awaited<ReturnType<typeof makePassedSlot>>> {
    const base = await makePassedSlot(opts);
    await confirm(base.merchantToken, base.slotId).expect(200);
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(base.binding.handle, 'alive'));
    await scheduler.tick();
    expect((await loadSlot(base.slotId)).status).toBe('paid');
    return base;
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
    disputes = app.get(DisputesService);
    verification = app.get(VerificationService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM "disputes"`);
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
    await ds.query(`DELETE FROM "disputes"`);
    await ds.getRepository(VerificationJob).delete({ type: 'delivery' });
    await ds.getRepository(VerificationJob).delete({ type: 'payout' });
    await ds.query(
      `UPDATE "order_slots"
          SET "status" = 'expired'
        WHERE "status" IN ('verifying', 'passed', 'reserved', 'disputed')`,
    );
    fakeScraper.getTweet.mockReset();
    fakeScraper.getTweet.mockRejectedValue(new XUpstreamError('fake: 未排队的推文'));
    fakeScraper.getProfile.mockReset();
    fakeScraper.getRecentTweets.mockReset();
  });

  it('确认窗内商家争议 → slot disputed、撤销 pending payout、cron 跳过', async () => {
    const { merchant, merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    const escrowBefore = await escrowAvailable();

    // 商家已点确认：已有 pending payout job。
    await confirm(merchantToken, slotId).expect(200);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);

    const res = await raiseDispute(merchantToken, slotId, '交付内容与要求不符').expect(201);
    expect(res.body).toMatchObject({
      slotId,
      raisedBy: 'merchant',
      kind: 'quality',
      status: 'open',
      statement: '交付内容与要求不符',
    });

    const row = await loadSlot(slotId);
    expect(row.status).toBe('disputed');
    expect(row.survivalOverride).toBe(false);

    // pending payout job 被撤销。
    expect(await jobsOf(slotId, 'payout')).toHaveLength(0);

    // 自动放款 cron 只拾取 passed，争议名额被跳过。
    await setSlotConfirmDeadline(slotId, new Date(Date.now() - 1_000));
    const swept = await settlement.sweep();
    expect(swept.payouts).toBe(0);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(0);
    expect((await loadOrder(row.orderId)).escrowMicro).toBe(100n * XM);
    expect(await escrowAvailable()).toBe(escrowBefore);

    // 双方收到通知。
    const merchantNotes = await notificationsFor(merchant.id, 'dispute_opened');
    const creatorNotes = await notificationsFor(taker.id, 'dispute_opened');
    expect(merchantNotes).toHaveLength(1);
    expect(creatorNotes).toHaveLength(1);
    expect(merchantNotes[0]).toMatchObject({ refType: 'slot', refId: slotId });
    expect(creatorNotes[0]).toMatchObject({ refType: 'slot', refId: slotId });
  });

  it('非商家发起争议 → 403；同一名额重复 open 争议 → 409', async () => {
    const { merchantToken, takerToken, slotId } = await makePassedSlot();

    await raiseDispute(takerToken, slotId).expect(403);
    await raiseDispute(merchantToken, slotId).expect(201);
    await raiseDispute(merchantToken, slotId).expect(409);
  });

  it('裁决 payout → slot 回 passed + survival_override → 推文已删也照常放款', async () => {
    const { merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    await confirm(merchantToken, slotId).expect(200);
    const raised = await raiseDispute(merchantToken, slotId).expect(201);

    const admin = await makeUser('admin');
    const resolved = await disputes.resolve(
      raised.body.id,
      'payout',
      admin.id,
      '人工复核后放行',
    );
    expect(resolved.status).toBe('resolved_payout');

    const row = await loadSlot(slotId);
    expect(row.status).toBe('passed');
    expect(row.survivalOverride).toBe(true);
    expect(await jobsOf(slotId, 'payout')).toHaveLength(1);

    // 推文已删：survival_override 应跳过存活复检，不被弹回 verifying。
    fakeScraper.getTweet.mockClear();
    fakeScraper.getTweet.mockRejectedValue(new XNotFoundError('推文已删除'));
    await scheduler.tick();

    expect(fakeScraper.getTweet).not.toHaveBeenCalled();
    const paid = await loadSlot(slotId);
    expect(paid.status).toBe('paid');
    expect(await availableOf(taker.id)).toBe(95n * XM);

    const notes = await notificationsFor(taker.id, 'dispute_resolved');
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('放款');
  });

  it('T13 人工核验放行同样写 survival_override → 放款不受删推文影响', async () => {
    const { token: merchantToken, orderId } = await makeOrder({
      priceXm: '100',
      slots: 1,
    });
    const { user: taker, binding } = await makeTaker();
    const takerToken = await signToken(taker);
    const slot = (await take(takerToken, orderId).expect(201)).body;
    await deliver(takerToken, slot.id, tweetUrl(binding.handle)).expect(200);
    expect((await loadSlot(slot.id)).status).toBe('verifying');

    const admin = await makeUser('admin');
    await verification.adminResolveDelivery(slot.id, true, admin.id);

    const passed = await loadSlot(slot.id);
    expect(passed.status).toBe('passed');
    expect(passed.survivalOverride).toBe(true);

    await confirm(merchantToken, slot.id).expect(200);
    fakeScraper.getTweet.mockClear();
    fakeScraper.getTweet.mockRejectedValue(new XNotFoundError('推文已删除'));
    await scheduler.tick();

    expect(fakeScraper.getTweet).not.toHaveBeenCalled();
    expect((await loadSlot(slot.id)).status).toBe('paid');
    expect(await availableOf(taker.id)).toBe(95n * XM);
  });

  it('裁决 refund → escrow −P、商家回款 P、slot refunded、订单 completed', async () => {
    const { merchant, merchantToken, taker, slotId } = await makePassedSlot({
      priceXm: '100',
      slots: 1,
    });
    const raised = await raiseDispute(merchantToken, slotId, '质量不合格').expect(201);

    const admin = await makeUser('admin');
    const merchantBefore = await availableOf(merchant.id);
    const escrowBefore = await escrowAvailable();

    const resolved = await disputes.resolve(
      raised.body.id,
      'refund',
      admin.id,
      '验收不通过',
    );
    expect(resolved.status).toBe('resolved_refund');

    const row = await loadSlot(slotId);
    expect(row.status).toBe('refunded');
    expect(await availableOf(merchant.id)).toBe(merchantBefore + 100n * XM);
    expect(await escrowAvailable()).toBe(escrowBefore - 100n * XM);

    const order = await loadOrder(row.orderId);
    expect(order.escrowMicro).toBe(0n);
    expect(order.status).toBe('completed');

    // 接单方未入账。
    expect(await availableOf(taker.id)).toBe(0n);

    const entries = await ds.getRepository(LedgerEntry).find({
      where: { refType: 'slot', refId: slotId },
    });
    expect(entries.filter((entry) => entry.kind === 'order_refund')).toHaveLength(2);

    const dispute = await loadDispute(raised.body.id);
    expect(dispute.ruling).toContain('验收不通过');
    expect(dispute.resolvedBy).toBe(admin.id);
    expect(dispute.resolvedAt).toBeInstanceOf(Date);

    // 双方收到裁决通知。
    expect(await notificationsFor(merchant.id, 'dispute_resolved')).toHaveLength(1);
    expect(await notificationsFor(taker.id, 'dispute_resolved')).toHaveLength(1);

    // 已结案：再次裁决 400。
    await expect(
      disputes.resolve(raised.body.id, 'refund', admin.id, '重复裁决'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('删帖追回：余额足够 → 全额 P 划回商家、violations 不变', async () => {
    const { merchant, merchantToken, taker, slotId } = await makePaidSlot({
      priceXm: '100',
      slots: 1,
    });
    // 接单方另有余额，凑够 P。
    await fund(taker.id, 20n * XM);

    const merchantBefore = await availableOf(merchant.id);
    const reported = await reportDeletion(merchantToken, slotId, '推文已被删除').expect(201);
    expect(reported.body).toMatchObject({
      slotId,
      raisedBy: 'merchant',
      kind: 'deletion',
      status: 'open',
    });

    // 举报删帖不改名额状态。
    expect((await loadSlot(slotId)).status).toBe('paid');
    // 重复举报 → 409。
    await reportDeletion(merchantToken, slotId).expect(409);

    const admin = await makeUser('admin');
    const resolved = await disputes.resolve(
      reported.body.id,
      'clawback',
      admin.id,
      '确认删帖',
    );
    expect(resolved.status).toBe('resolved_clawback');

    expect(await availableOf(merchant.id)).toBe(merchantBefore + 100n * XM);
    expect(await availableOf(taker.id)).toBe(15n * XM);

    const creator = await ds.getRepository(User).findOneOrFail({ where: { id: taker.id } });
    expect(creator.violations).toBe(0);

    const entries = await ds.getRepository(LedgerEntry).find({
      where: { refType: 'slot', refId: slotId },
    });
    expect(entries.filter((entry) => entry.kind === 'deletion_clawback')).toHaveLength(2);

    const dispute = await loadDispute(reported.body.id);
    expect(dispute.status).toBe('resolved_clawback');
    expect(dispute.arbiterMeta).toMatchObject({
      adminId: admin.id,
      note: '确认删帖',
      shortfallMicro: '0',
    });

    // 结案后同一 slot 不得再次举报（否则可在 7 天窗口内反复追回）。
    const takerAfterClawback = await availableOf(taker.id);
    const again = await reportDeletion(merchantToken, slotId).expect(409);
    expect(again.body.message).toContain('已处理过');
    expect(await availableOf(taker.id)).toBe(takerAfterClawback);
    expect(
      await ds.getRepository(Dispute).count({ where: { slotId, kind: 'deletion' } }),
    ).toBe(1);
  });

  it('删帖追回：余额不足 → 部分追回 + violations+1 + ruling 记差额', async () => {
    const { merchant, merchantToken, taker, slotId } = await makePaidSlot({
      priceXm: '100',
      slots: 1,
    });
    // 接单方只有放款到手 95，追不回全额 100。
    expect(await availableOf(taker.id)).toBe(95n * XM);

    const merchantBefore = await availableOf(merchant.id);
    const reported = await reportDeletion(merchantToken, slotId).expect(201);

    const admin = await makeUser('admin');
    const resolved = await disputes.resolve(
      reported.body.id,
      'clawback',
      admin.id,
      '确认删帖',
    );
    expect(resolved.status).toBe('resolved_clawback');

    expect(await availableOf(taker.id)).toBe(0n);
    expect(await availableOf(merchant.id)).toBe(merchantBefore + 95n * XM);

    const creator = await ds.getRepository(User).findOneOrFail({ where: { id: taker.id } });
    expect(creator.violations).toBe(1);

    const dispute = await loadDispute(reported.body.id);
    expect(dispute.ruling).toContain('差额');
    expect(dispute.ruling).toContain('5');
    expect(dispute.arbiterMeta).toMatchObject({
      recoveredMicro: String(95n * XM),
      shortfallMicro: String(5n * XM),
    });
  });

  it('窗口外：passed 超 48h / paid 超 7 天 → 400', async () => {
    // 确认窗已过。
    const passed = await makePassedSlot();
    await setSlotConfirmDeadline(passed.slotId, new Date(Date.now() - 1_000));
    await raiseDispute(passed.merchantToken, passed.slotId).expect(400);

    // 放款超过 7 天。
    const paid = await makePaidSlot();
    await setSlotSettledAt(paid.slotId, new Date(Date.now() - 8 * DAY_MS));
    await reportDeletion(paid.merchantToken, paid.slotId).expect(400);

    // 未放款的名额不能举报删帖。
    const passed2 = await makePassedSlot();
    await reportDeletion(passed2.merchantToken, passed2.slotId).expect(400);
  });

  it('respond：仅当事人可追加 evidence；结案后 400', async () => {
    const { merchant, merchantToken, taker, takerToken, slotId } =
      await makePassedSlot();
    const raised = await raiseDispute(merchantToken, slotId).expect(201);

    // 第三人 403。
    const outsider = await makeUser();
    await respond(await signToken(outsider), raised.body.id, '路过').expect(403);

    // 接单方与商家均可回应。
    const first = await respond(takerToken, raised.body.id, '我按要求交付了').expect(200);
    expect(first.body.evidence).toHaveLength(1);
    expect(first.body.evidence[0]).toMatchObject({
      by: taker.id,
      role: 'creator',
      statement: '我按要求交付了',
    });

    const second = await respond(
      merchantToken,
      raised.body.id,
      '推文缺少关键词',
    ).expect(200);
    expect(second.body.evidence).toHaveLength(2);
    expect(second.body.evidence[1]).toMatchObject({
      by: merchant.id,
      role: 'merchant',
      statement: '推文缺少关键词',
    });

    // 接单方不能发起质量争议（只有下单商家可以）。
    await raiseDispute(takerToken, slotId).expect(403);

    // 结案后 respond 400。
    const admin = await makeUser('admin');
    await disputes.resolve(raised.body.id, 'refund', admin.id, '按证据裁决');
    await respond(takerToken, raised.body.id, '再补充').expect(400);
  });
});
