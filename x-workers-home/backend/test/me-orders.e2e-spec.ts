import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MICRO, pctFloor } from '../src/common/money';
import { Order } from '../src/orders/order.entity';
import { OrderSlot } from '../src/slots/order-slot.entity';
import { User } from '../src/users/user.entity';

const XM = MICRO;

const REQUIREMENTS = {
  keywords: ['alpha'],
  hashtags: ['#xwh'],
  mentions: [],
  links: [],
};

describe('GET /api/me/orders（商家本人订单 + 名额数据）e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let jwt: JwtService;

  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(
    opts: { nickname?: string | null; ratingGrade?: string | null } = {},
  ): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: 'active',
        role: 'user',
        nickname: opts.nickname ?? null,
        ratingGrade: opts.ratingGrade ?? null,
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

  async function insertOrder(
    merchantUserId: string,
    overrides: Partial<Order> = {},
  ): Promise<Order> {
    const priceMicro = (overrides.priceMicro as bigint | undefined) ?? 100n * XM;
    const slotsTotal = overrides.slotsTotal ?? 2;
    const feeMicro =
      (overrides.feeMicro as bigint | undefined) ??
      pctFloor(priceMicro * BigInt(slotsTotal), 5, 100);
    const repo = ds.getRepository(Order);
    const order = await repo.save(
      repo.create({
        merchantUserId,
        type: 'post',
        title: '我的商单',
        brief: '商单说明',
        requirements: REQUIREMENTS,
        targetTweetUrl: null,
        priceMicro,
        slotsTotal,
        feeMicro,
        feeEarned: false,
        escrowMicro: priceMicro * BigInt(slotsTotal) + feeMicro,
        status: 'recruiting',
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        minRatingGrade: null,
        closedAt: null,
        ...overrides,
      }),
    );
    createdOrderIds.push(order.id);
    return order;
  }

  async function insertSlot(
    orderId: string,
    creatorUserId: string,
    overrides: Partial<OrderSlot> = {},
  ): Promise<OrderSlot> {
    const acceptedAt = new Date(Date.now() - 30 * 60 * 1000);
    const repo = ds.getRepository(OrderSlot);
    return repo.save(
      repo.create({
        orderId,
        creatorUserId,
        status: 'verifying',
        acceptedAt,
        deliverDeadlineAt: new Date(acceptedAt.getTime() + 3 * 3600 * 1000),
        deliveredAt: new Date(acceptedAt.getTime() + 10 * 60 * 1000),
        deliveryUrl: null,
        deliveryTweetId: null,
        lastReject: null,
        verifySnapshot: null,
        manualReasons: [],
        appealRequested: false,
        confirmedDeadlineAt: null,
        settledAt: null,
        ...overrides,
      }),
    );
  }

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
      if (createdOrderIds.length) {
        await ds.getRepository(OrderSlot).delete({ orderId: In(createdOrderIds) });
        await ds.getRepository(Order).delete({ id: In(createdOrderIds) });
      }
      if (createdUserIds.length) {
        await ds.getRepository(User).delete({ id: In(createdUserIds) });
      }
    }
    await app.close();
  });

  it('仅返回本人订单（含全部状态），带名额的交付链接 / 驳回原因 / 申诉标记', async () => {
    const merchant = await makeUser({ nickname: '商家甲' });
    const other = await makeUser({ nickname: '商家乙' });
    const creator1 = await makeUser({ nickname: '接单人一', ratingGrade: 'A' });
    const creator2 = await makeUser({ nickname: '接单人二', ratingGrade: 'B' });

    const order = await insertOrder(merchant.id, {
      title: '招募中的单',
      type: 'post',
      priceMicro: 100n * XM,
      slotsTotal: 2,
      feeMicro: 10n * XM,
      feeEarned: true,
      escrowMicro: 210n * XM,
      status: 'recruiting',
    });
    const closedOrder = await insertOrder(merchant.id, {
      title: '已下架的单',
      type: 'quote',
      status: 'closed',
      closedAt: new Date(),
    });
    const foreignOrder = await insertOrder(other.id, { title: '别人的单' });

    // 明确 createdAt 顺序：closedOrder 最新。
    await ds.query(`UPDATE "orders" SET "created_at" = now() - interval '3 min' WHERE "id" = $1`, [
      order.id,
    ]);
    await ds.query(`UPDATE "orders" SET "created_at" = now() - interval '1 min' WHERE "id" = $1`, [
      closedOrder.id,
    ]);

    const deliveryUrl = 'https://x.com/creator_one/status/1234567890';
    const slot1 = await insertSlot(order.id, creator1.id, {
      status: 'verifying',
      deliveryUrl,
      deliveryTweetId: '1234567890',
    });
    const confirmedDeadlineAt = new Date(Date.now() + 48 * 3600 * 1000);
    const slot2 = await insertSlot(order.id, creator2.id, {
      status: 'passed',
      confirmedDeadlineAt,
      lastReject: { reasons: ['缺少关键词 alpha'], at: new Date().toISOString() },
      appealRequested: true,
    });
    // 别的商单名额不应混入
    await insertSlot(foreignOrder.id, creator1.id);

    const token = await signToken(merchant);
    const res = await request(server())
      .get('/api/me/orders')
      .set(auth(token))
      .expect(200);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((item: any) => item.id)).toEqual([closedOrder.id, order.id]);
    expect(res.body.items.map((item: any) => item.id)).not.toContain(foreignOrder.id);

    const mine = res.body.items.find((item: any) => item.id === order.id);
    expect(mine).toMatchObject({
      id: order.id,
      type: 'post',
      title: '招募中的单',
      priceXm: '100',
      slotsTotal: 2,
      escrowXm: '210',
      feeEarned: true,
      status: 'recruiting',
    });
    expect(mine.expiresAt).toEqual(expect.any(String));
    expect(mine.createdAt).toEqual(expect.any(String));
    expect(mine.slots).toHaveLength(2);

    const byId = new Map<string, any>(mine.slots.map((slot: any) => [slot.id, slot]));
    const first = byId.get(slot1.id);
    expect(first).toMatchObject({
      id: slot1.id,
      status: 'verifying',
      deliveryUrl,
      lastReject: null,
      appealRequested: false,
      confirmedDeadlineAt: null,
      settledAt: null,
      creator: { id: creator1.id, nickname: '接单人一', ratingGrade: 'A' },
    });
    expect(first.acceptedAt).toEqual(expect.any(String));
    expect(first.deliverDeadlineAt).toEqual(expect.any(String));

    const second = byId.get(slot2.id);
    expect(second).toMatchObject({
      id: slot2.id,
      status: 'passed',
      deliveryUrl: null,
      appealRequested: true,
      creator: { id: creator2.id, nickname: '接单人二', ratingGrade: 'B' },
    });
    expect(second.confirmedDeadlineAt).toEqual(confirmedDeadlineAt.toISOString());
    expect(second.lastReject).toMatchObject({ reasons: ['缺少关键词 alpha'] });

    // 他人订单不可见
    const otherToken = await signToken(other);
    const otherRes = await request(server())
      .get('/api/me/orders')
      .set(auth(otherToken))
      .expect(200);
    expect(otherRes.body.items.map((item: any) => item.id)).toEqual([foreignOrder.id]);

    // 未登录 401
    await request(server()).get('/api/me/orders').expect(401);
  });

  it('无订单返回空数组；非 UUID / 非法参数无关（无入参）', async () => {
    const loner = await makeUser();
    const token = await signToken(loner);
    const res = await request(server())
      .get('/api/me/orders')
      .set(auth(token))
      .expect(200);
    expect(res.body).toEqual({ items: [] });
  });
});
