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
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { Order } from '../src/orders/order.entity';
import { User } from '../src/users/user.entity';

const XM = MICRO;

const REQUIREMENTS = {
  keywords: ['alpha'],
  hashtags: ['#xwh'],
  mentions: [],
  links: [],
};

describe('商单创建 / 公开列表 / 下架退款 e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];
  let handleSeq = 0;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(
    opts: { status?: string; ratingGrade?: string | null } = {},
  ): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: opts.status ?? 'active',
        role: 'user',
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

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      type: 'post',
      title: '测试商单',
      brief: '这是一条测试商单的说明',
      requirements: REQUIREMENTS,
      priceXm: '100',
      slots: 3,
      ...overrides,
    };
  }

  function createOrder(token: string, overrides: Record<string, unknown> = {}) {
    return request(server())
      .post('/api/orders')
      .set(auth(token))
      .send(payload(overrides));
  }

  function closeOrder(token: string, id: string) {
    return request(server())
      .post(`/api/orders/${id}/close`)
      .set(auth(token));
  }

  function listOrders(query = '') {
    return request(server()).get(`/api/orders${query}`);
  }

  function getOrder(id: string) {
    return request(server()).get(`/api/orders/${id}`);
  }

  /** 直接插库造列表数据（列表端点只读，不涉及托管资金）。 */
  async function insertOrder(
    merchantUserId: string,
    overrides: Partial<Order> = {},
  ): Promise<Order> {
    const priceMicro = (overrides.priceMicro as bigint | undefined) ?? 10n * XM;
    const slotsTotal = overrides.slotsTotal ?? 3;
    const feeMicro =
      (overrides.feeMicro as bigint | undefined) ??
      pctFloor(priceMicro * BigInt(slotsTotal), 5, 100);
    const repo = ds.getRepository(Order);
    return repo.save(
      repo.create({
        merchantUserId,
        type: 'post',
        title: '列表测试单',
        brief: '列表测试说明',
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
  }

  async function setCreatedAt(id: string, at: Date): Promise<void> {
    await ds.query(`UPDATE "orders" SET "created_at" = $1 WHERE "id" = $2`, [at, id]);
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    ledger = app.get(LedgerService);
    jwt = app.get(JwtService);
  });

  beforeEach(async () => {
    // 本文件的用例互不污染：只清理本文件创建的用户所发商单
    if (createdUserIds.length) {
      await ds.getRepository(Order).delete({ merchantUserId: In(createdUserIds) });
    }
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (createdUserIds.length) {
        await ds.getRepository(Order).delete({ merchantUserId: In(createdUserIds) });
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

  it('建单冻结数学：P=100,N=3 → 冻结 315、escrow=315、可用减 315', async () => {
    const user = await makeUser();
    await bindX(user.id);
    await fund(user.id, 1000n * XM);
    const token = await signToken(user);

    const beforeAvailable = await availableOf(user.id);
    const beforeEscrow = await escrowAvailable();

    const res = await createOrder(token).expect(201);

    expect(res.body).toMatchObject({
      type: 'post',
      title: '测试商单',
      priceXm: '100',
      payoutXm: '95',
      slotsTotal: 3,
      slotsAvailable: 3,
      merchantRatingGrade: null,
      status: 'recruiting',
    });
    expect(res.body.id).toEqual(expect.any(String));
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const row = await ds.getRepository(Order).findOneOrFail({ where: { id: res.body.id } });
    expect(row.priceMicro).toBe(100n * XM);
    expect(row.slotsTotal).toBe(3);
    expect(row.feeMicro).toBe(15n * XM);
    expect(row.feeEarned).toBe(false);
    expect(row.escrowMicro).toBe(315n * XM);
    expect(row.status).toBe('recruiting');
    expect(row.closedAt).toBeNull();
    // 默认 7 天（±2 分钟容差）
    const sevenDays = 7 * 24 * 3600 * 1000;
    expect(Math.abs(row.expiresAt.getTime() - Date.now() - sevenDays)).toBeLessThan(120_000);

    expect(await availableOf(user.id)).toBe(beforeAvailable - 315n * XM);
    expect(await escrowAvailable()).toBe(beforeEscrow + 315n * XM);

    // 托管不变量：escrow_micro = P×N + fee
    expect(row.escrowMicro).toBe(row.priceMicro * BigInt(row.slotsTotal) + row.feeMicro);

    // 流水：用户 −315 / escrow +315，kind=order_freeze
    const entries = await ds.getRepository(LedgerEntry).find({
      where: { kind: 'order_freeze', refType: 'user', refId: user.id },
      order: { availableDelta: 'ASC' },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].availableDelta).toBe(-315n * XM);
    expect(entries[1].availableDelta).toBe(315n * XM);
    expect(entries[1].accountId).toBe(PLATFORM_ACCOUNTS.escrow);
  });

  it('校验：comment 缺 targetTweetUrl / 非法金额 / 边界 / 未登录 / 无绑定 / 非 active', async () => {
    const user = await makeUser();
    await bindX(user.id);
    await fund(user.id, 1000n * XM);
    const token = await signToken(user);

    // 未登录
    await request(server()).post('/api/orders').send(payload()).expect(401);

    // comment / quote 必须带合法目标推文链接
    const missing = await createOrder(token, { type: 'comment' }).expect(400);
    expect(missing.body.message).toContain('目标推文');

    await createOrder(token, {
      type: 'comment',
      targetTweetUrl: 'https://example.com/user/status/123',
    }).expect(400);

    await createOrder(token, {
      type: 'quote',
      targetTweetUrl: 'https://x.com/user/status/123',
    }).expect(201);

    // priceXm：必须是 ≥1 的整数 XM
    await createOrder(token, { type: 'post', priceXm: '0' }).expect(400);
    await createOrder(token, { type: 'post', priceXm: '0.5' }).expect(400);
    await createOrder(token, { type: 'post', priceXm: 'abc' }).expect(400);
    await createOrder(token, { type: 'post', priceXm: '-1' }).expect(400);

    // slots 1..1000
    await createOrder(token, { type: 'post', slots: 0 }).expect(400);
    await createOrder(token, { type: 'post', slots: 1001 }).expect(400);
    await createOrder(token, { type: 'post', slots: 1.5 }).expect(400);

    // expiresInDays 1..30
    await createOrder(token, { type: 'post', expiresInDays: 31 }).expect(400);
    await createOrder(token, { type: 'post', expiresInDays: 0 }).expect(400);

    // 类型枚举
    await createOrder(token, { type: 'video' }).expect(400);

    // 余额不足：事务回滚，不建单
    const poor = await makeUser();
    await bindX(poor.id);
    await fund(poor.id, 100n * XM);
    const poorToken = await signToken(poor);
    await createOrder(poorToken, {
      type: 'post',
      priceXm: '100',
      slots: 3,
    }).expect(400);
    expect(await ds.getRepository(Order).count({ where: { merchantUserId: poor.id } })).toBe(0);

    // 无 X 绑定 → 400
    const unbound = await makeUser();
    await fund(unbound.id, 1000n * XM);
    const unboundToken = await signToken(unbound);
    const unboundRes = await createOrder(unboundToken, { type: 'post' }).expect(400);
    expect(unboundRes.body.message).toContain('X 绑定');

    // 用户非 active → 403
    const suspended = await makeUser({ status: 'pending_x_binding' });
    await bindX(suspended.id);
    await fund(suspended.id, 1000n * XM);
    const suspendedToken = await signToken(suspended);
    await createOrder(suspendedToken, { type: 'post' }).expect(403);
  });

  it('从未被接 → close 全额退（315 回可用、escrow 回原值、income 无入账）', async () => {
    const user = await makeUser();
    await bindX(user.id);
    await fund(user.id, 1000n * XM);
    const token = await signToken(user);

    const beforeAvailable = await availableOf(user.id);
    const beforeEscrow = await escrowAvailable();
    const beforeIncome = await incomeAvailable();

    const created = await createOrder(token).expect(201);
    const orderId = created.body.id;

    const closed = await closeOrder(token, orderId).expect(200);
    expect(closed.body).toMatchObject({ id: orderId, status: 'closed' });
    expect(closed.body.closedAt).toEqual(expect.any(String));

    expect(await availableOf(user.id)).toBe(beforeAvailable);
    expect(await escrowAvailable()).toBe(beforeEscrow);
    expect(await incomeAvailable()).toBe(beforeIncome);

    const row = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(row.status).toBe('closed');
    expect(row.closedAt).toBeInstanceOf(Date);
    expect(row.escrowMicro).toBe(0n);

    // 退款流水 escrow → user，ref 指向商单
    const entries = await ds.getRepository(LedgerEntry).find({
      where: { kind: 'order_refund', refType: 'order', refId: orderId },
      order: { availableDelta: 'ASC' },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].availableDelta).toBe(-315n * XM);
    expect(entries[0].accountId).toBe(PLATFORM_ACCOUNTS.escrow);
    expect(entries[1].availableDelta).toBe(315n * XM);
    expect(entries[1].userId).toBe(user.id);

    // 下架单仍可公开查看
    const detail = await getOrder(orderId).expect(200);
    expect(detail.body.status).toBe('closed');
    expect(detail.body.closedAt).toEqual(expect.any(String));

    // 重复下架 → 400
    await closeOrder(token, orderId).expect(400);

    // 非商家下架 → 403
    const other = await makeUser();
    const otherToken = await signToken(other);
    const another = await createOrder(token).expect(201);
    await closeOrder(otherToken, another.body.id).expect(403);

    // 不存在 → 404
    await closeOrder(token, randomUUID()).expect(404);
  });

  it('fee_earned=true（已有接单）→ close 只退自由池，fee 不退', async () => {
    const user = await makeUser();
    await bindX(user.id);
    await fund(user.id, 1000n * XM);
    const token = await signToken(user);

    const created = await createOrder(token).expect(201);
    const orderId = created.body.id;

    // 模拟 T12「首次被抢」：fee 从 escrow 转 income，订单标记 fee_earned
    const fee = 15n * XM;
    await ds.transaction(async (tx) => {
      await ledger.transfer(tx, {
        from: { platform: 'escrow' },
        to: { platform: 'income' },
        amountMicro: fee,
        kind: 'posting_fee',
        ref: { type: 'order', id: orderId },
      });
    });
    await ds.getRepository(Order).update(orderId, { feeEarned: true, escrowMicro: 300n * XM });

    const beforeAvailable = await availableOf(user.id);
    const beforeEscrow = await escrowAvailable();
    const beforeIncome = await incomeAvailable();

    await closeOrder(token, orderId).expect(200);

    // 只退自由池 P×N = 300；fee 留在 income
    expect(await availableOf(user.id)).toBe(beforeAvailable + 300n * XM);
    expect(await escrowAvailable()).toBe(beforeEscrow - 300n * XM);
    expect(await incomeAvailable()).toBe(beforeIncome);

    const row = await ds.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(row.escrowMicro).toBe(0n);
    expect(row.status).toBe('closed');
  });

  it('列表公开可访问：默认 recruiting、type 过滤、price 排序、分页、slotsAvailable/rating', async () => {
    const merchant = await makeUser({ ratingGrade: 'A' });
    await bindX(merchant.id);

    const types = ['post', 'comment', 'quote'];
    for (let i = 0; i < 21; i++) {
      const order = await insertOrder(merchant.id, {
        type: types[i % 3] as Order['type'],
        title: `列表单 ${String(i).padStart(2, '0')}`,
        priceMicro: BigInt(1 + (i % 5)) * 10n * XM,
        slotsTotal: 2 + (i % 3),
        targetTweetUrl: i % 3 === 0 ? null : 'https://x.com/user/status/123',
      });
      await setCreatedAt(order.id, new Date(Date.now() - (21 - i) * 60_000));
    }
    const closed = await insertOrder(merchant.id, { title: '已下架单', status: 'closed' });

    // 未登录可访问
    const page1 = await listOrders().expect(200);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(20);
    expect(page1.body.total).toBe(21);
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.items.map((o: any) => o.id)).not.toContain(closed.id);

    // 默认按最新
    expect(page1.body.items[0].title).toBe('列表单 20');
    expect(page1.body.items[19].title).toBe('列表单 01');

    // 分页第 2 页
    const page2 = await listOrders('?page=2').expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].title).toBe('列表单 00');

    // type 过滤
    const comments = await listOrders('?type=comment').expect(200);
    expect(comments.body.total).toBe(7);
    expect(comments.body.items.every((o: any) => o.type === 'comment')).toBe(true);

    // price 降序
    const byPrice = await listOrders('?sort=price').expect(200);
    const prices = byPrice.body.items.map((o: any) => Number(o.priceXm));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));

    // 字段与派生值
    const item = page1.body.items[0];
    expect(item).toMatchObject({
      slotsTotal: expect.any(Number),
      slotsAvailable: item.slotsTotal,
      merchantRatingGrade: 'A',
      status: 'recruiting',
      priceXm: expect.any(String),
      payoutXm: expect.any(String),
    });
    expect(item.requirements).toMatchObject({ keywords: ['alpha'] });
    expect(item.expiresAt).toEqual(expect.any(String));

    // price=10 → payout=9.5
    const ten = byPrice.body.items.find((o: any) => o.priceXm === '10');
    expect(ten.payoutXm).toBe('9.5');

    // 详情公开（recruiting + closed 均可）
    const detail = await getOrder(page1.body.items[0].id).expect(200);
    expect(detail.body.id).toBe(page1.body.items[0].id);
    await getOrder(closed.id).expect(200);

    // 不存在 / 非 UUID
    await getOrder(randomUUID()).expect(404);
    await getOrder('not-a-uuid').expect(400);
  });
});
