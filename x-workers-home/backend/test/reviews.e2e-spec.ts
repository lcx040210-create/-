import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { Notification } from '../src/notifications/notification.entity';
import { Order } from '../src/orders/order.entity';
import { Review } from '../src/reviews/review.entity';
import { OrderSlot, OrderSlotStatus } from '../src/slots/order-slot.entity';
import { User } from '../src/users/user.entity';

const XM = MICRO;
const HOUR_MS = 60 * 60 * 1000;

describe('双向互评 e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let jwt: JwtService;

  const createdUserIds: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(
    opts: { role?: string; nickname?: string | null } = {},
  ): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: 'active',
        role: opts.role ?? 'user',
        nickname: opts.nickname ?? null,
        ratingGrade: null,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  /**
   * 直接构造名额：评价只依赖 slot.status='paid' 与订单商家，
   * 无需重跑抢单/核验/放款链路。
   */
  async function makeSlot(
    opts: { merchant?: User; taker?: User; status?: OrderSlotStatus } = {},
  ): Promise<{ merchant: User; taker: User; orderId: string; slotId: string }> {
    const merchant = opts.merchant ?? (await makeUser());
    const taker = opts.taker ?? (await makeUser());
    const status = opts.status ?? 'paid';

    const order = await ds.getRepository(Order).save(
      ds.getRepository(Order).create({
        merchantUserId: merchant.id,
        type: 'post',
        title: '互评测试商单',
        brief: '互评测试说明',
        requirements: { keywords: [], hashtags: [], mentions: [], links: [] },
        targetTweetUrl: null,
        priceMicro: 100n * XM,
        slotsTotal: 1,
        feeMicro: 5n * XM,
        feeEarned: true,
        escrowMicro: 0n,
        status: 'completed',
        expiresAt: new Date(Date.now() + 24 * HOUR_MS),
        minRatingGrade: null,
        closedAt: new Date(),
      }),
    );

    const slot = await ds.getRepository(OrderSlot).save(
      ds.getRepository(OrderSlot).create({
        orderId: order.id,
        creatorUserId: taker.id,
        status,
        acceptedAt: new Date(),
        deliverDeadlineAt: new Date(Date.now() + 3 * HOUR_MS),
        deliveredAt: new Date(),
        deliveryUrl: `https://x.com/tester/status/${Date.now()}`,
        settledAt: status === 'paid' ? new Date() : null,
      }),
    );

    return { merchant, taker, orderId: order.id, slotId: slot.id };
  }

  async function signToken(user: User): Promise<string> {
    return jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: process.env.JWT_SECRET, expiresIn: '1h' },
    );
  }

  const postReview = (
    token: string,
    slotId: string,
    body: Record<string, unknown>,
  ) =>
    request(server())
      .post(`/api/slots/${slotId}/review`)
      .set(auth(token))
      .send(body);

  const getRating = (userId: string) =>
    request(server()).get(`/api/users/${userId}/rating`);

  const notificationsFor = (userId: string, kind?: string) =>
    ds.getRepository(Notification).find({
      where: kind ? { userId, kind } : { userId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM "reviews"`);
      if (createdUserIds.length) {
        await ds.getRepository(Order).delete({ merchantUserId: In(createdUserIds) });
        await ds.getRepository(Notification).delete({ userId: In(createdUserIds) });
        await ds.getRepository(User).delete({ id: In(createdUserIds) });
      }
    }
    await app.close();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM "reviews"`);
    if (createdUserIds.length) {
      await ds.getRepository(Order).delete({ merchantUserId: In(createdUserIds) });
      await ds.getRepository(Notification).delete({ userId: In(createdUserIds) });
    }
  });

  it('paid 后双方各能评一次；重复 → 409；通知被评方', async () => {
    const { merchant, taker, orderId, slotId } = await makeSlot();
    const merchantToken = await signToken(merchant);
    const takerToken = await signToken(taker);

    // 商家评接单方。
    const merchantReview = await postReview(merchantToken, slotId, {
      score: 5,
      comment: '交付及时，内容优质',
    }).expect(201);
    expect(merchantReview.body).toMatchObject({
      slotId,
      orderId,
      fromUserId: merchant.id,
      toUserId: taker.id,
      score: 5,
      comment: '交付及时，内容优质',
    });
    expect(Number.isNaN(new Date(merchantReview.body.createdAt).getTime())).toBe(false);

    // 接单方评商家（comment 可省略 → null）。
    const takerReview = await postReview(takerToken, slotId, { score: 4 }).expect(201);
    expect(takerReview.body).toMatchObject({
      slotId,
      orderId,
      fromUserId: taker.id,
      toUserId: merchant.id,
      score: 4,
      comment: null,
    });

    expect(await ds.getRepository(Review).count({ where: { slotId } })).toBe(2);

    // 每侧只能一次：重复 → 409，不产生新行。
    const merchantDup = await postReview(merchantToken, slotId, { score: 1 }).expect(409);
    expect(merchantDup.body.message).toContain('已评价');
    await postReview(takerToken, slotId, { score: 2 }).expect(409);
    expect(await ds.getRepository(Review).count({ where: { slotId } })).toBe(2);

    // 被评方各自收到一条 review_received 通知。
    const takerNotes = await notificationsFor(taker.id, 'review_received');
    expect(takerNotes).toHaveLength(1);
    expect(takerNotes[0]).toMatchObject({ refType: 'slot', refId: slotId });
    const merchantNotes = await notificationsFor(merchant.id, 'review_received');
    expect(merchantNotes).toHaveLength(1);
    expect(merchantNotes[0]).toMatchObject({ refType: 'slot', refId: slotId });
  });

  it('未 paid 名额评分 → 400（passed / reserved 均拒绝）', async () => {
    const passed = await makeSlot({ status: 'passed' });
    const passedMerchantToken = await signToken(passed.merchant);
    const passedTakerToken = await signToken(passed.taker);
    await postReview(passedMerchantToken, passed.slotId, { score: 5 }).expect(400);
    await postReview(passedTakerToken, passed.slotId, { score: 5 }).expect(400);

    const reserved = await makeSlot({ status: 'reserved' });
    const reservedMerchantToken = await signToken(reserved.merchant);
    await postReview(reservedMerchantToken, reserved.slotId, { score: 5 }).expect(400);

    expect(await ds.getRepository(Review).count()).toBe(0);
  });

  it('非当事人 → 403；不存在的名额 → 404', async () => {
    const { slotId } = await makeSlot();
    const outsider = await makeUser();
    const outsiderToken = await signToken(outsider);

    await postReview(outsiderToken, slotId, { score: 5 }).expect(403);
    expect(await ds.getRepository(Review).count({ where: { slotId } })).toBe(0);

    await postReview(outsiderToken, randomUUID(), { score: 5 }).expect(404);
  });

  it('商家 == 接单方（自抢单）→ 评价自己 400；正常互评不受影响', async () => {
    const self = await makeUser();
    const { slotId } = await makeSlot({ merchant: self, taker: self });
    const token = await signToken(self);

    const res = await postReview(token, slotId, { score: 5 }).expect(400);
    expect(res.body.message).toContain('不能评价自己');
    expect(await ds.getRepository(Review).count({ where: { slotId } })).toBe(0);

    // 正常两名当事人的互评不受该守卫影响。
    const normal = await makeSlot();
    await postReview(await signToken(normal.merchant), normal.slotId, { score: 5 }).expect(201);
    await postReview(await signToken(normal.taker), normal.slotId, { score: 4 }).expect(201);
  });

  it('score 越界 / 非整数 / 多余字段 → 400', async () => {
    const { merchant, slotId } = await makeSlot();
    const token = await signToken(merchant);

    await postReview(token, slotId, { score: 0 }).expect(400);
    await postReview(token, slotId, { score: 6 }).expect(400);
    await postReview(token, slotId, { score: 4.5 }).expect(400);
    await postReview(token, slotId, { score: '5' }).expect(400);
    await postReview(token, slotId, { score: 5, unexpected: true }).expect(400);

    expect(await ds.getRepository(Review).count({ where: { slotId } })).toBe(0);
  });

  it('average：无评价 = null；单个 5 星 = 5；多条保留一位小数', async () => {
    const emptyUser = await makeUser();
    const empty = await getRating(emptyUser.id).expect(200);
    expect(empty.body).toEqual({ average: null, count: 0, recent: [] });

    // 单人单条 5 星。
    const single = await makeSlot({ taker: emptyUser });
    await postReview(await signToken(single.merchant), single.slotId, { score: 5 }).expect(201);
    const singleRating = await getRating(emptyUser.id).expect(200);
    expect(singleRating.body.average).toBe(5);
    expect(singleRating.body.count).toBe(1);

    // 多人多条：5 + 4 + 4 = 13 / 3 → 4.3。
    const multi = await makeUser();
    for (const score of [5, 4, 4]) {
      const slot = await makeSlot({ taker: multi });
      await postReview(await signToken(slot.merchant), slot.slotId, { score }).expect(201);
    }
    const multiRating = await getRating(multi.id).expect(200);
    expect(multiRating.body.average).toBe(4.3);
    expect(multiRating.body.count).toBe(3);
    expect(multiRating.body.recent).toHaveLength(3);

    // 不存在的用户 → 404。
    await getRating(randomUUID()).expect(404);
  });

  it('recent：按时间倒序取最近 10 条，含 score/comment/createdAt/from 昵称', async () => {
    const reviewer = await makeUser({ nickname: '评价者' });
    const target = await makeUser();
    const reviewerToken = await signToken(reviewer);
    const base = Date.now() - 12 * 60_000;

    for (let i = 0; i < 12; i += 1) {
      const slot = await makeSlot({ merchant: reviewer, taker: target });
      await postReview(reviewerToken, slot.slotId, {
        score: (i % 5) + 1,
        comment: `review-${i}`,
      }).expect(201);
      // 固定时间线，避免同毫秒 createdAt 造成排序不确定。
      await ds.query(
        `UPDATE "reviews" SET "created_at" = $1 WHERE "slot_id" = $2`,
        [new Date(base + i * 60_000), slot.slotId],
      );
    }

    const res = await getRating(target.id).expect(200);
    expect(res.body.count).toBe(12);
    expect(res.body.recent).toHaveLength(10);
    // 最新的 11..2，最早的 0..1 被截掉。
    expect(res.body.recent.map((item: any) => item.comment)).toEqual([
      'review-11',
      'review-10',
      'review-9',
      'review-8',
      'review-7',
      'review-6',
      'review-5',
      'review-4',
      'review-3',
      'review-2',
    ]);
    expect(res.body.recent[0]).toMatchObject({
      score: 2,
      comment: 'review-11',
      from: { id: reviewer.id, nickname: '评价者' },
    });
    expect(typeof res.body.recent[0].createdAt).toBe('string');
    expect(Number.isNaN(new Date(res.body.recent[0].createdAt).getTime())).toBe(false);
  });
});
