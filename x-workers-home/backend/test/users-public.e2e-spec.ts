import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { Order } from '../src/orders/order.entity';
import { OrderSlot, OrderSlotStatus } from '../src/slots/order-slot.entity';
import { User } from '../src/users/user.entity';

const XM = MICRO;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('公开主页用户信息 e2e（GET /api/users/:id/public）', () => {
  let app: INestApplication;
  let ds: DataSource;

  const createdUserIds: string[] = [];

  const server = () => app.getHttpServer();
  const getPublic = (id: string) => request(server()).get(`/api/users/${id}/public`);

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(opts: { ratingGrade?: string | null } = {}): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: 'active',
        role: 'user',
        nickname: '测试昵称',
        ratingGrade: opts.ratingGrade ?? null,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function makeBinding(
    user: User,
    opts: { status?: 'pending' | 'active' | 'manual'; verifiedAt?: Date } = {},
  ): Promise<XBinding> {
    const binding = await ds.getRepository(XBinding).save(
      ds.getRepository(XBinding).create({
        userId: user.id,
        handle: `h${Math.random().toString(36).slice(2, 10)}`,
        code: `XWH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: opts.status ?? 'active',
        verifiedAt: opts.verifiedAt ?? new Date(Date.now() - 30 * DAY_MS),
      }),
    );
    return binding;
  }

  /** 直接构造订单 + 名额：完成数只依赖 creator_user_id 与 status='paid'。 */
  async function makeSlot(
    creator: User,
    status: OrderSlotStatus,
  ): Promise<OrderSlot> {
    const order = await ds.getRepository(Order).save(
      ds.getRepository(Order).create({
        merchantUserId: (await makeUser()).id,
        type: 'post',
        title: '公开主页测试商单',
        brief: '测试说明',
        requirements: { keywords: [], hashtags: [], mentions: [], links: [] },
        targetTweetUrl: null,
        priceMicro: 100n * XM,
        slotsTotal: 3,
        feeMicro: 5n * XM,
        feeEarned: true,
        escrowMicro: 0n,
        status: 'completed',
        expiresAt: new Date(Date.now() + HOUR_MS),
        minRatingGrade: null,
        closedAt: new Date(),
      }),
    );

    return ds.getRepository(OrderSlot).save(
      ds.getRepository(OrderSlot).create({
        orderId: order.id,
        creatorUserId: creator.id,
        status,
        acceptedAt: new Date(),
        deliverDeadlineAt: new Date(Date.now() + 3 * HOUR_MS),
        deliveredAt: new Date(),
        deliveryUrl: `https://x.com/tester/status/${randomUUID().slice(0, 12)}`,
        settledAt: status === 'paid' ? new Date() : null,
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
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM "order_slots"`);
      await ds.query(`DELETE FROM "orders"`);
      await ds.query(`DELETE FROM "x_bindings"`);
      if (createdUserIds.length) {
        await ds.query(`DELETE FROM "refresh_tokens" WHERE "user_id" = ANY($1)`, [
          createdUserIds,
        ]);
        await ds.query(`DELETE FROM "users" WHERE "id" = ANY($1)`, [createdUserIds]);
      }
    }
    await app.close();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM "order_slots"`);
    await ds.query(`DELETE FROM "orders"`);
    await ds.query(`DELETE FROM "x_bindings"`);
  });

  it('公开可访问：返回 id/handle/joined/ratingGrade/completedCount/xBound，且不泄露敏感字段', async () => {
    const user = await makeUser({ ratingGrade: 'A' });
    const verifiedAt = new Date('2026-08-01T03:04:05.000Z');
    const binding = await makeBinding(user, { status: 'active', verifiedAt });
    await makeSlot(user, 'paid');
    await makeSlot(user, 'paid');
    await makeSlot(user, 'expired');
    await makeSlot(user, 'refunded');

    const res = await getPublic(user.id).expect(200);

    expect(res.body).toEqual({
      id: user.id,
      handle: binding.handle,
      joined: verifiedAt.toISOString(),
      ratingGrade: 'A',
      completedCount: 2,
      xBound: true,
    });
    // 公开端点绝不暴露地址 / 邀请码 / 密码 / 角色等字段。
    expect(Object.keys(res.body).sort()).toEqual(
      ['completedCount', 'handle', 'id', 'joined', 'ratingGrade', 'xBound'].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain(user.address);
    expect(JSON.stringify(res.body)).not.toContain('refCode');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('未绑定 X：handle=null、xBound=false、joined=users.created_at', async () => {
    const user = await makeUser({ ratingGrade: null });

    const res = await getPublic(user.id).expect(200);

    expect(res.body.handle).toBeNull();
    expect(res.body.xBound).toBe(false);
    expect(res.body.joined).toBe(user.createdAt.toISOString());
    expect(res.body.ratingGrade).toBeNull();
    expect(res.body.completedCount).toBe(0);
  });

  it('pending 绑定不算已绑定：handle=null、joined 回落 users.created_at', async () => {
    const user = await makeUser();
    const binding = await makeBinding(user, { status: 'pending' });
    // verifiedAt 对 pending 无意义：置空，确保 joined 必须回落到 users.created_at。
    await ds.getRepository(XBinding).update({ userId: binding.userId }, { verifiedAt: null });

    const res = await getPublic(user.id).expect(200);

    expect(res.body.handle).toBeNull();
    expect(res.body.xBound).toBe(false);
    expect(res.body.joined).toBe(user.createdAt.toISOString());
  });

  it('完成数只统计该用户作为接单方的 paid 名额', async () => {
    const user = await makeUser();
    const other = await makeUser();
    await makeSlot(user, 'paid');
    await makeSlot(user, 'passed');
    await makeSlot(user, 'disputed');
    await makeSlot(other, 'paid');

    const res = await getPublic(user.id).expect(200);
    expect(res.body.completedCount).toBe(1);
  });

  it('未知用户 → 404', async () => {
    const res = await getPublic(randomUUID()).expect(404);
    expect(res.body.message).toBe('用户不存在');
  });

  it('非法 id → 400（不崩溃）', async () => {
    await getPublic('not-a-uuid').expect(400);
  });
});
