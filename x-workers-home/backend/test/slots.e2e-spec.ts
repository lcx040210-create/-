import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { MICRO, pctFloor } from '../src/common/money';
import { PLATFORM_ACCOUNTS } from '../src/database/migrations/1700000003000-ledger';
import { VerificationJob } from '../src/jobs/verification-job.entity';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { Notification } from '../src/notifications/notification.entity';
import { Order } from '../src/orders/order.entity';
import { Referral } from '../src/referral/referral.entity';
import { OrderSlot } from '../src/slots/order-slot.entity';
import { SlotsService } from '../src/slots/slots.service';
import { User } from '../src/users/user.entity';

const XM = MICRO;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const REQUIREMENTS = {
  keywords: ['alpha'],
  hashtags: ['#xwh'],
  mentions: [],
  links: [],
};

describe('抢单防超卖 / 交付 / 3h 超时 e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let slotsService: SlotsService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];
  let handleSeq = 0;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(
    opts: { status?: string; nickname?: string; ratingGrade?: string | null } = {},
  ): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: opts.status ?? 'active',
        role: 'user',
        nickname: opts.nickname ?? null,
        ratingGrade: opts.ratingGrade ?? null,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function bindX(userId: string): Promise<void> {
    const handle = `u${randomUUID().replace(/-/g, '').slice(0, 12)}${handleSeq++}`.slice(0, 15);
    await ds.getRepository(XBinding).save(
      ds.getRepository(XBinding).create({
        userId,
        handle,
        code: 'XWH-TEST01',
        status: 'active',
        verifiedAt: new Date(),
      }),
    );
  }

  /** 接单方需 active + X 绑定 active（spec §2）。 */
  async function makeTaker(
    opts: { nickname?: string; ratingGrade?: string | null } = {},
  ): Promise<User> {
    const user = await makeUser(opts);
    await bindX(user.id);
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

  /** 建单（走真实 API，冻结 P×N + fee）。 */
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
        title: '抢单测试商单',
        brief: '抢单测试用的商单说明',
        requirements: REQUIREMENTS,
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

  const getOrder = (id: string) => request(server()).get(`/api/orders/${id}`);
  const getMySlots = (token: string) =>
    request(server()).get('/api/me/slots').set(auth(token));

  async function slotRows(orderId: string): Promise<OrderSlot[]> {
    return ds.getRepository(OrderSlot).find({
      where: { orderId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * 托管不变量：
   * - 招募中：escrow = P × (slots_total − paid − refunded) + (fee_earned ? 0 : fee)；
   *   expired 不占名额也不消耗托管，因此不从括号中扣除。
   * - 下架后：自由池已退款，escrow 只剩活跃名额占用的 P。
   */
  async function assertEscrowInvariant(orderId: string): Promise<void> {
    const order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    if (order.status === 'closed') {
      const held: Array<{ count: number }> = await ds.query(
        `SELECT COUNT(*)::int AS count FROM "order_slots"
          WHERE "order_id" = $1
            AND "status" IN ('reserved','verifying','passed','disputed')`,
        [orderId],
      );
      expect(order.escrowMicro).toBe(order.priceMicro * BigInt(held[0].count));
      return;
    }
    const rows = await ds.query(
      `SELECT COUNT(*)::int AS count FROM "order_slots"
        WHERE "order_id" = $1 AND "status" IN ('paid','refunded')`,
      [orderId],
    );
    const expected =
      order.priceMicro * BigInt(order.slotsTotal - rows[0].count) +
      (order.feeEarned ? 0n : order.feeMicro);
    expect(order.escrowMicro).toBe(expected);
  }

  async function setDeadline(slotId: string, at: Date): Promise<void> {
    await ds.query(
      `UPDATE "order_slots" SET "deliver_deadline_at" = $1 WHERE "id" = $2`,
      [at, slotId],
    );
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    ledger = app.get(LedgerService);
    slotsService = app.get(SlotsService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(VerificationJob).delete({ type: 'delivery' });
      if (createdUserIds.length) {
        // orders 级联删除 order_slots
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
            .delete({ accountId: In(accounts.map((a) => a.id)) });
        }
        await ds.getRepository(Account).delete({ ownerUserId: In(createdUserIds) });
        await ds.getRepository(User).delete({ id: In(createdUserIds) });
      }
    }
    await app.close();
  });

  it('并发抢最后 1 个名额：5 个用户并发 → 恰 1 成功、4 个 400（订单行锁防超卖）', async () => {
    const { orderId } = await makeOrder({ priceXm: '100', slots: 1 });
    const takers = await Promise.all(Array.from({ length: 5 }, () => makeTaker()));
    const tokens = await Promise.all(takers.map((u) => signToken(u)));

    // 先同步创建 5 个请求再一起 await：真实并发（独立 HTTP 连接 / 独立事务）
    const results = await Promise.allSettled(tokens.map((token) => take(token, orderId)));
    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : -1,
    );

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 400)).toHaveLength(4);

    const rows = await slotRows(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('reserved');

    const order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.feeEarned).toBe(true);
    expect(order.escrowMicro).toBe(100n * XM); // 105 − fee 5
    await assertEscrowInvariant(orderId);
  });

  it('2 个名额：5 个用户并发 → 恰 2 成功、3 个 400', async () => {
    const { orderId } = await makeOrder({ priceXm: '100', slots: 2 });
    const takers = await Promise.all(Array.from({ length: 5 }, () => makeTaker()));
    const tokens = await Promise.all(takers.map((u) => signToken(u)));

    const results = await Promise.allSettled(tokens.map((token) => take(token, orderId)));
    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : -1,
    );

    expect(statuses.filter((status) => status === 201)).toHaveLength(2);
    expect(statuses.filter((status) => status === 400)).toHaveLength(3);

    const rows = await slotRows(orderId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.creatorUserId)).size).toBe(2);
    await assertEscrowInvariant(orderId);
  });

  it('同一用户对同一单二次抢 → 400；首单成功且交付截止 = 接单 + 3h', async () => {
    const { orderId } = await makeOrder({ slots: 2 });
    const user = await makeTaker();
    const token = await signToken(user);

    const first = await take(token, orderId).expect(201);
    expect(first.body).toMatchObject({
      orderId,
      status: 'reserved',
      deliveryUrl: null,
      lastReject: null,
      appealRequested: false,
    });
    const acceptedAt = new Date(first.body.acceptedAt).getTime();
    const deadlineAt = new Date(first.body.deliverDeadlineAt).getTime();
    expect(deadlineAt - acceptedAt).toBe(THREE_HOURS_MS);
    expect(deadlineAt).toBeGreaterThan(Date.now() + THREE_HOURS_MS - 60_000);

    const second = await take(token, orderId).expect(400);
    expect(second.body.message).toContain('已在本单');
    expect(await slotRows(orderId)).toHaveLength(1);
  });

  it('部分唯一索引：同单同用户第二个活跃名额被 DB 拒绝；expired / refunded 不占位', async () => {
    const { orderId } = await makeOrder({ slots: 3 });
    const taker = await makeTaker();

    const insert = (status: string): Promise<Array<{ id: string }>> =>
      ds.query(
        `INSERT INTO "order_slots"
           ("order_id","creator_user_id","status","accepted_at","deliver_deadline_at")
         VALUES ($1,$2,$3, now(), now() + interval '3 hours')
         RETURNING "id"`,
        [orderId, taker.id, status],
      );

    const first = await insert('reserved');
    await expect(insert('reserved')).rejects.toThrow(/uq_order_slots_active_creator/);
    await expect(insert('verifying')).rejects.toThrow(/uq_order_slots_active_creator/);

    // refunded 不占唯一名额
    await ds.query(`UPDATE "order_slots" SET "status"='refunded' WHERE "id"=$1`, [
      first[0].id,
    ]);
    const second = await insert('reserved');

    // expired 不占唯一名额
    await ds.query(`UPDATE "order_slots" SET "status"='expired' WHERE "id"=$1`, [
      second[0].id,
    ]);
    await expect(insert('reserved')).resolves.toHaveLength(1);
  });

  it('首抢才收发单费：escrow−fee、income+fee、返佣 20% 同事务；后续抢单不再收费', async () => {
    const { merchant, orderId } = await makeOrder({ priceXm: '100', slots: 3 });
    // 商家有邀请人：返佣从 platform_income 自供资
    const referrer = await makeUser();
    await ds.getRepository(Referral).save(
      ds.getRepository(Referral).create({
        referrerUserId: referrer.id,
        inviteeUserId: merchant.id,
      }),
    );

    const fee = pctFloor(100n * XM * 3n, 5, 100); // 15 XM
    const rebate = pctFloor(fee, 20, 100); // 3 XM

    const escrowBefore = await escrowAvailable();
    const incomeBefore = await incomeAvailable();
    const referrerBefore = await availableOf(referrer.id);

    const takerA = await makeTaker();
    const takerB = await makeTaker();
    await take(await signToken(takerA), orderId).expect(201);

    expect(await escrowAvailable()).toBe(escrowBefore - fee);
    expect(await incomeAvailable()).toBe(incomeBefore + fee - rebate);
    expect(await availableOf(referrer.id)).toBe(referrerBefore + rebate);

    let order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.feeEarned).toBe(true);
    expect(order.escrowMicro).toBe(300n * XM);
    await assertEscrowInvariant(orderId);

    // 第二次抢单：fee 已赚，不再产生任何转账
    const escrowMid = await escrowAvailable();
    const incomeMid = await incomeAvailable();
    await take(await signToken(takerB), orderId).expect(201);
    expect(await escrowAvailable()).toBe(escrowMid);
    expect(await incomeAvailable()).toBe(incomeMid);

    order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(300n * XM);
    await assertEscrowInvariant(orderId);

    const feeEntries = await ds.getRepository(LedgerEntry).find({
      where: { kind: 'posting_fee', refType: 'order', refId: orderId },
      order: { availableDelta: 'ASC' },
    });
    expect(feeEntries).toHaveLength(2);
    expect(feeEntries[0].availableDelta).toBe(-fee);
    expect(feeEntries[0].accountId).toBe(PLATFORM_ACCOUNTS.escrow);
    expect(feeEntries[1].availableDelta).toBe(fee);
    expect(feeEntries[1].accountId).toBe(PLATFORM_ACCOUNTS.income);

    const rebateEntries = await ds.getRepository(LedgerEntry).find({
      where: { kind: 'referral_rebate', refType: 'user', refId: merchant.id },
      order: { availableDelta: 'ASC' },
    });
    expect(rebateEntries).toHaveLength(2);
    expect(rebateEntries[1].userId).toBe(referrer.id);
    expect(rebateEntries[1].availableDelta).toBe(rebate);
  });

  it('escrow 不变量贯穿 create → take → deliver → expire（expired 不消耗托管）', async () => {
    const { orderId } = await makeOrder({ priceXm: '100', slots: 2 });
    const fee = 10n * XM;

    let order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(210n * XM);
    expect(order.feeEarned).toBe(false);
    await assertEscrowInvariant(orderId);

    const takerA = await makeTaker();
    const tokenA = await signToken(takerA);
    const slotA = (await take(tokenA, orderId).expect(201)).body;
    order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(210n * XM - fee);
    await assertEscrowInvariant(orderId);

    await deliver(tokenA, slotA.id, 'https://x.com/taker_a/status/111').expect(200);
    order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(210n * XM - fee);
    await assertEscrowInvariant(orderId);

    const takerB = await makeTaker();
    await take(await signToken(takerB), orderId).expect(201);
    order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(200n * XM);
    await assertEscrowInvariant(orderId);

    // 让 B 的名额超时：expired 回池，escrow 不变
    const rows = await slotRows(orderId);
    const slotB = rows.find((row) => row.creatorUserId === takerB.id)!;
    await setDeadline(slotB.id, new Date(Date.now() - 1000));
    expect(await slotsService.expireOverdue()).toBe(1);

    order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(200n * XM);
    await assertEscrowInvariant(orderId);
  });

  it('3h 超时：reserved→expired、violations+1、通知落库、名额回池可再抢（escrow 不动、商家不回款）', async () => {
    const { merchant, orderId } = await makeOrder({ priceXm: '100', slots: 1 });
    const takerA = await makeTaker();
    const slotA = (await take(await signToken(takerA), orderId).expect(201)).body;

    const before = await ds.getRepository(User).findOneOrFail({ where: { id: takerA.id } });
    expect(before.violations).toBe(0);

    await setDeadline(slotA.id, new Date(Date.now() - 1000));
    expect(await slotsService.expireOverdue()).toBe(1);

    const expired = await ds
      .getRepository(OrderSlot)
      .findOneOrFail({ where: { id: slotA.id } });
    expect(expired.status).toBe('expired');
    expect(expired.deliveredAt).toBeNull();

    const userAfter = await ds.getRepository(User).findOneOrFail({ where: { id: takerA.id } });
    expect(userAfter.violations).toBe(1);

    const notifications = await ds.getRepository(Notification).find({
      where: { userId: takerA.id, kind: 'slot_expired' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      refType: 'slot',
      refId: slotA.id,
      readAt: null,
    });
    expect(notifications[0].title).toContain('超时');

    // 幂等：重复扫描不重复记违约 / 通知
    expect(await slotsService.expireOverdue()).toBe(0);
    expect(
      (await ds.getRepository(User).findOneOrFail({ where: { id: takerA.id } })).violations,
    ).toBe(1);
    expect(
      await ds.getRepository(Notification).count({
        where: { userId: takerA.id, kind: 'slot_expired' },
      }),
    ).toBe(1);

    // 名额回池：他人可再抢；escrow 保持不变，商家未收到任何退款
    const escrowBefore = await escrowAvailable();
    const merchantBefore = await availableOf(merchant.id);
    const takerB = await makeTaker();
    await take(await signToken(takerB), orderId).expect(201);
    const activeRows = (await slotRows(orderId)).filter((row) => row.status !== 'expired');
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].creatorUserId).toBe(takerB.id);
    expect(await escrowAvailable()).toBe(escrowBefore);
    expect(await availableOf(merchant.id)).toBe(merchantBefore);
  });

  it('交付：reserved→verifying、记录链接、delivery 任务入队；非本人 403、重复交付 400', async () => {
    const { orderId } = await makeOrder({ slots: 2 });
    const taker = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;

    const url = 'https://x.com/creator/status/123456';
    const delivered = await deliver(token, slot.id, url).expect(200);
    expect(delivered.body).toMatchObject({
      id: slot.id,
      status: 'verifying',
      deliveryUrl: url,
    });
    expect(delivered.body.deliveredAt).toEqual(expect.any(String));

    const row = await ds.getRepository(OrderSlot).findOneOrFail({ where: { id: slot.id } });
    expect(row.status).toBe('verifying');
    expect(row.deliveryUrl).toBe(url);
    expect(row.deliveredAt).toBeInstanceOf(Date);

    const jobs = await ds.getRepository(VerificationJob).find({
      where: { type: 'delivery', refId: slot.id },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('pending');
    expect(jobs[0].payload).toEqual({});

    // 重复交付 → 400（状态已不是 reserved）
    await deliver(token, slot.id, 'https://x.com/creator/status/999').expect(400);

    // 他人交付 → 403
    const stranger = await makeUser();
    await deliver(await signToken(stranger), slot.id, url).expect(403);

    // 未登录 → 401
    await request(server())
      .post(`/api/slots/${slot.id}/deliver`)
      .send({ deliveryUrl: url })
      .expect(401);
  });

  it('deadline 之后交付 → 400（锁内复核），名额保持 reserved 等待 cron', async () => {
    const { orderId } = await makeOrder({ slots: 1 });
    const taker = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;

    await setDeadline(slot.id, new Date(Date.now() - 1));
    const res = await deliver(token, slot.id, 'https://x.com/creator/status/321').expect(400);
    expect(res.body.message).toContain('截止');

    const row = await ds.getRepository(OrderSlot).findOneOrFail({ where: { id: slot.id } });
    expect(row.status).toBe('reserved');
    expect(row.deliveryUrl).toBeNull();
    expect(
      await ds.getRepository(VerificationJob).count({ where: { type: 'delivery', refId: slot.id } }),
    ).toBe(0);
  });

  it('同一交付链接出现在其他名额 → 409（且不落 task）', async () => {
    const { orderId } = await makeOrder({ slots: 2 });
    const takerA = await makeTaker();
    const takerB = await makeTaker();
    const tokenA = await signToken(takerA);
    const tokenB = await signToken(takerB);
    const slotA = (await take(tokenA, orderId).expect(201)).body;
    const slotB = (await take(tokenB, orderId).expect(201)).body;

    const url = 'https://x.com/shared/status/777';
    await deliver(tokenA, slotA.id, url).expect(200);

    const conflict = await deliver(tokenB, slotB.id, url).expect(409);
    expect(conflict.body.message).toContain('链接');

    const rowB = await ds.getRepository(OrderSlot).findOneOrFail({ where: { id: slotB.id } });
    expect(rowB.status).toBe('reserved');
    expect(rowB.deliveryUrl).toBeNull();
    expect(
      await ds.getRepository(VerificationJob).count({ where: { type: 'delivery', refId: slotB.id } }),
    ).toBe(0);
  });

  it('两个名额并发交付同一 URL → 恰一个成功、一个 409；变体链接同样拒绝', async () => {
    const { orderId } = await makeOrder({ slots: 2 });
    const takerA = await makeTaker();
    const takerB = await makeTaker();
    const tokenA = await signToken(takerA);
    const tokenB = await signToken(takerB);
    const slotA = (await take(tokenA, orderId).expect(201)).body;
    const slotB = (await take(tokenB, orderId).expect(201)).body;

    const url = 'https://x.com/race/status/4242';
    const results = await Promise.allSettled([
      deliver(tokenA, slotA.id, url),
      deliver(tokenB, slotB.id, url),
    ]);
    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : -1,
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);

    const rows = await slotRows(orderId);
    expect(rows.filter((row) => row.status === 'verifying')).toHaveLength(1);
    expect(rows.filter((row) => row.status === 'reserved')).toHaveLength(1);
    expect(
      await ds.getRepository(VerificationJob).count({
        where: { type: 'delivery', refId: In([slotA.id, slotB.id]) },
      }),
    ).toBe(1);

    // 变体绕过（twitter.com / 大写路径 / 尾斜杠 / 查询串）→ 规范化后仍命中唯一链接
    const loser = rows.find((row) => row.status === 'reserved')!;
    const loserToken = loser.creatorUserId === takerA.id ? tokenA : tokenB;
    const variant = await deliver(
      loserToken,
      loser.id,
      'http://www.twitter.com/Race/status/4242/?s=20#top',
    ).expect(409);
    expect(variant.body.message).toContain('链接');

    // 迁移的部分唯一索引本身兜底（即使代码预查被绕过）
    await expect(
      ds.query(`UPDATE "order_slots" SET "delivery_url" = $1 WHERE "id" = $2`, [
        url,
        loser.id,
      ]),
    ).rejects.toThrow(/uq_order_slots_delivery_url/);
  });

  it('close 携带：有活跃名额只退自由池（escrow − P×active），fee 不退，活跃名额保留', async () => {
    const { merchant, token: merchantToken, orderId } = await makeOrder({
      priceXm: '100',
      slots: 3,
    });
    const takerA = await makeTaker();
    const takerB = await makeTaker();
    await take(await signToken(takerA), orderId).expect(201);
    await take(await signToken(takerB), orderId).expect(201);

    const merchantBefore = await availableOf(merchant.id);
    const escrowBefore = await escrowAvailable();

    const closed = await request(server())
      .post(`/api/orders/${orderId}/close`)
      .set(auth(merchantToken))
      .expect(200);

    // 自由池 = 3 − 2 = 1；退款 = escrow(300) − P×2 = 100
    expect(closed.body).toMatchObject({
      id: orderId,
      status: 'closed',
      slotsTotal: 3,
      slotsAvailable: 1,
    });
    expect(await availableOf(merchant.id)).toBe(merchantBefore + 100n * XM);
    expect(await escrowAvailable()).toBe(escrowBefore - 100n * XM);

    const order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(200n * XM); // P×2 托管继续由活跃名额占用
    expect(order.feeEarned).toBe(true);
    await assertEscrowInvariant(orderId);

    const active = (await slotRows(orderId)).filter((row) => row.status !== 'expired');
    expect(active).toHaveLength(2);

    const refundEntries = await ds.getRepository(LedgerEntry).find({
      where: { kind: 'order_refund', refType: 'order', refId: orderId },
      order: { availableDelta: 'ASC' },
    });
    expect(refundEntries).toHaveLength(2);
    expect(refundEntries[0].accountId).toBe(PLATFORM_ACCOUNTS.escrow);
    expect(refundEntries[0].availableDelta).toBe(-100n * XM);
    expect(refundEntries[1].userId).toBe(merchant.id);
    expect(refundEntries[1].availableDelta).toBe(100n * XM);
  });

  it('close 后活跃名额超时 → 名额 refunded、P 退商家、escrow 不变量成立（不回池）', async () => {
    const { merchant, token: merchantToken, orderId } = await makeOrder({
      priceXm: '100',
      slots: 3,
    });
    const takerA = await makeTaker();
    const takerB = await makeTaker();
    await take(await signToken(takerA), orderId).expect(201);
    const slotB = (await take(await signToken(takerB), orderId).expect(201)).body;

    await request(server())
      .post(`/api/orders/${orderId}/close`)
      .set(auth(merchantToken))
      .expect(200);
    const merchantAfterClose = await availableOf(merchant.id);
    expect(
      (await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } })).escrowMicro,
    ).toBe(200n * XM);

    // 隔离：先消化此前用例遗留的到期名额，保证本次扫描计数只针对 slotB
    await slotsService.expireOverdue();
    await setDeadline(slotB.id, new Date(Date.now() - 1000));
    const escrowBefore = await escrowAvailable();
    expect(await slotsService.expireOverdue()).toBe(1);

    // 名额置 refunded（不是 expired、不回自由池），P 从 escrow 退回商家
    const expired = await ds.getRepository(OrderSlot).findOneOrFail({ where: { id: slotB.id } });
    expect(expired.status).toBe('refunded');
    expect(await availableOf(merchant.id)).toBe(merchantAfterClose + 100n * XM);
    expect(await escrowAvailable()).toBe(escrowBefore - 100n * XM);

    const order = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.escrowMicro).toBe(100n * XM); // A 的名额仍在托管
    await assertEscrowInvariant(orderId);

    const refundEntries = await ds.getRepository(LedgerEntry).find({
      where: { kind: 'order_refund', refType: 'slot', refId: slotB.id },
      order: { availableDelta: 'ASC' },
    });
    expect(refundEntries).toHaveLength(2);
    expect(refundEntries[0].accountId).toBe(PLATFORM_ACCOUNTS.escrow);
    expect(refundEntries[0].availableDelta).toBe(-100n * XM);
    expect(refundEntries[1].userId).toBe(merchant.id);
    expect(refundEntries[1].availableDelta).toBe(100n * XM);

    const takerAfter = await ds.getRepository(User).findOneOrFail({ where: { id: takerB.id } });
    expect(takerAfter.violations).toBe(1);
    expect(
      await ds.getRepository(Notification).count({
        where: { userId: takerB.id, kind: 'slot_expired' },
      }),
    ).toBe(1);
  });

  it('订单详情公开名额列表：状态/时间/昵称/评级，脱敏不暴露 delivery_url；slotsAvailable 扣减', async () => {
    const { orderId } = await makeOrder({ slots: 3 });
    const taker = await makeTaker({ nickname: 'Alice', ratingGrade: 'A' });
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;
    const url = 'https://x.com/secret-delivery/status/555';
    await deliver(token, slot.id, url).expect(200);

    const detail = await getOrder(orderId).expect(200);
    expect(detail.body.slotsTotal).toBe(3);
    expect(detail.body.slotsAvailable).toBe(2);
    expect(detail.body.slots).toHaveLength(1);
    expect(detail.body.slots[0]).toMatchObject({
      id: slot.id,
      status: 'verifying',
      creator: { nickname: 'Alice', ratingGrade: 'A' },
    });
    expect(detail.body.slots[0].acceptedAt).toEqual(expect.any(String));
    expect(detail.body.slots[0].deliverDeadlineAt).toEqual(expect.any(String));
    expect(detail.body.slots[0].deliveredAt).toEqual(expect.any(String));

    // 1.0 公开字段脱敏：绝不出现交付链接
    expect(detail.body.slots[0].deliveryUrl).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain(url);
    expect(JSON.stringify(detail.body)).not.toContain('secret-delivery');
  });

  it('GET /api/me/slots：本人名额 + 订单摘要 + 倒计时/deadline/lastReject/appeal；未登录 401', async () => {
    const { orderId } = await makeOrder({ slots: 2 });
    const taker = await makeTaker();
    const other = await makeUser();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;

    await request(server()).get('/api/me/slots').expect(401);

    const mine = await getMySlots(token).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({
      id: slot.id,
      orderId,
      status: 'reserved',
      deliveryUrl: null,
      lastReject: null,
      appealRequested: false,
      order: {
        id: orderId,
        title: '抢单测试商单',
        type: 'post',
        priceXm: '100',
        payoutXm: '95',
        status: 'recruiting',
      },
    });
    expect(mine.body.items[0].deliverDeadlineAt).toEqual(expect.any(String));
    expect(
      new Date(mine.body.items[0].deliverDeadlineAt).getTime() -
        new Date(mine.body.items[0].acceptedAt).getTime(),
    ).toBe(THREE_HOURS_MS);

    const others = await getMySlots(await signToken(other)).expect(200);
    expect(others.body.items).toHaveLength(0);
  });

  it('接单资格：需 active + X 绑定 active；未绑定 400、封禁 401，绑定后放行', async () => {
    const { orderId } = await makeOrder({ slots: 3 });

    const unbound = await makeUser();
    const unboundRes = await take(await signToken(unbound), orderId).expect(400);
    expect(unboundRes.body.message).toContain('X 绑定');

    // T17：封禁在 JWT validate 层全端点生效 → 401（不再进入业务 service）。
    const suspended = await makeUser({ status: 'suspended' });
    await bindX(suspended.id);
    const suspendedRes = await take(await signToken(suspended), orderId).expect(401);
    expect(suspendedRes.body.message).toContain('封禁');

    // 资格不满足时不产生名额
    expect(await slotRows(orderId)).toHaveLength(0);

    // 补绑 X 后同一用户可正常接单
    await bindX(unbound.id);
    await take(await signToken(unbound), orderId).expect(201);
    expect(await slotRows(orderId)).toHaveLength(1);
  });

  it('抢单校验：不存在 404、非 UUID 400、closed 400、已过期 400、满员 400', async () => {
    const taker = await makeTaker();
    const token = await signToken(taker);

    await take(token, randomUUID()).expect(404);
    await take(token, 'not-a-uuid').expect(400);

    // closed：建单后立即下架
    const closedOrder = await makeOrder({ slots: 1 });
    await request(server())
      .post(`/api/orders/${closedOrder.orderId}/close`)
      .set(auth(closedOrder.token))
      .expect(200);
    const closedRes = await take(token, closedOrder.orderId).expect(400);
    expect(closedRes.body.message).toContain('不可接');

    // 已过 expires_at
    const expiredOrder = await makeOrder({ slots: 1 });
    await ds.query(
      `UPDATE "orders" SET "expires_at" = now() - interval '1 second' WHERE "id" = $1`,
      [expiredOrder.orderId],
    );
    await take(token, expiredOrder.orderId).expect(400);

    // 满员（1 名额已被他人占）
    const fullOrder = await makeOrder({ slots: 1 });
    const first = await makeTaker();
    await take(await signToken(first), fullOrder.orderId).expect(201);
    const fullRes = await take(token, fullOrder.orderId).expect(400);
    expect(fullRes.body.message).toContain('名额已满');
  });
});
