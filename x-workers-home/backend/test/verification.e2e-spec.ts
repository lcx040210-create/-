import { BadRequestException, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { VerificationJob } from '../src/jobs/verification-job.entity';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { Notification } from '../src/notifications/notification.entity';
import { Order } from '../src/orders/order.entity';
import { Referral } from '../src/referral/referral.entity';
import { OrderSlot } from '../src/slots/order-slot.entity';
import { User } from '../src/users/user.entity';
import { VerificationService } from '../src/verification/verification.service';
import {
  XNotFoundError,
  XRateLimitError,
  XScraperService,
  XUpstreamError,
} from '../src/xscraper/xscraper.service';
import { XTweet } from '../src/xscraper/xscraper.types';

const XM = MICRO;
const HOUR_MS = 60 * 60 * 1000;
const RETRY_BACKOFF_MS = [60_000, 180_000, 600_000];

const fakeScraper = {
  getTweet: jest.fn(),
  getProfile: jest.fn(),
  getRecentTweets: jest.fn(),
};

describe('交付核验 / 重试 / 人工降级 / 申诉 e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let scheduler: SchedulerService;
  let verification: VerificationService;
  let jwt: JwtService;
  let jobRepo: Repository<VerificationJob>;

  const createdUserIds: string[] = [];
  let handleSeq = 0;
  let tweetSeq = 0;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(opts: { status?: string; role?: string } = {}): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: opts.status ?? 'active',
        role: opts.role ?? 'user',
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
        title: '核验测试商单',
        brief: '核验测试说明',
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

  function tweetUrl(handle: string): string {
    tweetSeq += 1;
    return `https://x.com/${handle}/status/${Date.now()}${tweetSeq}`;
  }

  function makeTweet(handle: string, text: string): XTweet {
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

  /** 同名额可能有历史轮次的 job：取最新一条。 */
  const getJob = (slotId: string) =>
    ds.getRepository(VerificationJob).findOne({
      where: { type: 'delivery', refId: slotId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

  const notificationsFor = (userId: string, kind?: string) =>
    ds.getRepository(Notification).find({
      where: kind ? { userId, kind } : { userId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

  async function rejectSlot(
    opts: {
      requirements?: Record<string, unknown>;
      tweetText?: string;
      error?: Error;
    } = {},
  ): Promise<{
    merchant: User;
    taker: User;
    binding: XBinding;
    token: string;
    orderId: string;
    slotId: string;
  }> {
    const { merchant, orderId } = await makeOrder({
      slots: 1,
      requirements: opts.requirements ?? { keywords: ['alpha'] },
    });
    const { user: taker, binding } = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;
    await deliver(token, slot.id, tweetUrl(binding.handle)).expect(200);

    if (opts.error) {
      fakeScraper.getTweet.mockRejectedValueOnce(opts.error);
    } else {
      fakeScraper.getTweet.mockResolvedValueOnce(
        makeTweet(binding.handle, opts.tweetText ?? 'no required keyword'),
      );
    }
    await scheduler.tick();

    return { merchant, taker, binding, token, orderId, slotId: slot.id };
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
    verification = app.get(VerificationService);
    jwt = app.get(JwtService);
    jobRepo = ds.getRepository(VerificationJob);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(VerificationJob).delete({ type: 'delivery' });
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
    // 隔离队列与遗留名额，保证退避/补偿计数只针对当前用例。
    await jobRepo.delete({ type: 'delivery' });
    await ds.query(`UPDATE "order_slots" SET "status" = 'expired' WHERE "status" = 'verifying'`);
    fakeScraper.getTweet.mockReset();
    fakeScraper.getTweet.mockRejectedValue(new XUpstreamError('fake: 未排队的推文'));
    fakeScraper.getProfile.mockReset();
    fakeScraper.getRecentTweets.mockReset();
  });

  it('通过 → passed + 48h 确认窗 + snapshot 落库 + 通知商家', async () => {
    const { merchant, orderId } = await makeOrder({
      requirements: {
        keywords: ['Alpha'],
        hashtags: ['#xwh'],
        mentions: ['bob'],
        links: ['x.com/promo'],
      },
    });
    const { user: taker, binding } = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;
    const deliverDeadlineBefore = slot.deliverDeadlineAt;

    const url = tweetUrl(binding.handle);
    await deliver(token, slot.id, url).expect(200);

    const tweet = makeTweet(
      binding.handle.toUpperCase(),
      'The ALPHA promo #XWH thanks @Bob https://x.com/promo/',
    );
    fakeScraper.getTweet.mockResolvedValueOnce(tweet);

    const before = Date.now();
    await scheduler.tick();
    const after = Date.now();

    const row = await loadSlot(slot.id);
    expect(row.status).toBe('passed');
    expect(fakeScraper.getTweet).toHaveBeenCalledWith(url);
    expect(row.deliverDeadlineAt.toISOString()).toBe(
      new Date(deliverDeadlineBefore).toISOString(),
    );
    expect(row.confirmedDeadlineAt).toBeInstanceOf(Date);
    const confirmMs = row.confirmedDeadlineAt!.getTime();
    expect(confirmMs - before).toBeGreaterThanOrEqual(48 * HOUR_MS - 5_000);
    expect(confirmMs - after).toBeLessThanOrEqual(48 * HOUR_MS + 5_000);
    expect(row.verifySnapshot).toEqual(tweet);
    expect(row.lastReject).toBeNull();

    const job = await getJob(slot.id);
    expect(job?.status).toBe('done');
    expect(job?.attempts).toBe(1);

    const merchantNotes = await notificationsFor(merchant.id, 'delivery_passed');
    expect(merchantNotes).toHaveLength(1);
    expect(merchantNotes[0].title).toContain('交付待确认');
    expect(merchantNotes[0]).toMatchObject({ refType: 'slot', refId: slot.id, readAt: null });
    expect(await notificationsFor(taker.id, 'delivery_rejected')).toHaveLength(0);

    // 幂等：任务 done 后再次 tick 不会重复通知
    await scheduler.tick(new Date(Date.now() + 60_000));
    expect(await notificationsFor(merchant.id, 'delivery_passed')).toHaveLength(1);
  });

  it('打回 → 回 reserved、deadline 不变、snapshot 留存、通知带 reasons；可改链接重交', async () => {
    const { merchant, orderId } = await makeOrder({
      requirements: { keywords: ['alpha'] },
    });
    const { user: taker, binding } = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;
    const deadlineBefore = slot.deliverDeadlineAt;

    const url = tweetUrl(binding.handle);
    await deliver(token, slot.id, url).expect(200);

    const badTweet = makeTweet(binding.handle, 'no required keyword here');
    fakeScraper.getTweet.mockResolvedValueOnce(badTweet);
    await scheduler.tick();

    let row = await loadSlot(slot.id);
    expect(row.status).toBe('reserved');
    expect(row.deliverDeadlineAt.toISOString()).toBe(new Date(deadlineBefore).toISOString());
    expect(row.deliveryUrl).toBe(url);
    expect(row.verifySnapshot).toEqual(badTweet);
    expect(row.lastReject).toMatchObject({ reasons: ['missing:alpha'] });
    expect(row.lastReject?.at).toEqual(expect.any(String));
    expect(new Date(row.lastReject!.at).getTime()).toBeGreaterThan(0);

    const takerNotes = await notificationsFor(taker.id, 'delivery_rejected');
    expect(takerNotes).toHaveLength(1);
    expect(takerNotes[0].body).toContain('missing:alpha');
    expect(takerNotes[0]).toMatchObject({ refType: 'slot', refId: slot.id });
    expect(await notificationsFor(merchant.id, 'delivery_passed')).toHaveLength(0);

    // 改链接重新交付 → 新任务 → 通过
    const url2 = tweetUrl(binding.handle);
    await deliver(token, slot.id, url2).expect(200);
    const goodTweet = makeTweet(binding.handle, 'ALPHA now');
    fakeScraper.getTweet.mockResolvedValueOnce(goodTweet);
    await scheduler.tick();

    row = await loadSlot(slot.id);
    expect(row.status).toBe('passed');
    expect(row.deliveryUrl).toBe(url2);
    expect(row.verifySnapshot).toEqual(goodTweet);
    expect(await notificationsFor(taker.id, 'delivery_rejected')).toHaveLength(1);
    expect(await notificationsFor(merchant.id, 'delivery_passed')).toHaveLength(1);
  });

  it('推文不存在（XNotFoundError）→ 按不通过处理：reason tweet_not_found，job 结束不重试', async () => {
    const { taker, slotId } = await rejectSlot({
      error: new XNotFoundError('没找到推文'),
    });

    const row = await loadSlot(slotId);
    expect(row.status).toBe('reserved');
    expect(row.lastReject?.reasons).toEqual(['tweet_not_found']);
    expect(row.verifySnapshot).toBeNull();

    const job = await getJob(slotId);
    expect(job?.status).toBe('done');
    expect(job?.attempts).toBe(1);

    const notes = await notificationsFor(taker.id, 'delivery_rejected');
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('tweet_not_found');
  });

  it('限流 → job 按 [1m,3m,10m] 退避；第 4 次失败 → manual、名额停在 verifying、manual_reasons 追加', async () => {
    const { orderId } = await makeOrder({ slots: 1, requirements: { keywords: [] } });
    const { user: taker, binding } = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;
    await deliver(token, slot.id, tweetUrl(binding.handle)).expect(200);

    const error = new XRateLimitError('rate limited');
    fakeScraper.getTweet.mockRejectedValue(error);

    const t0 = new Date();
    await scheduler.tick(t0);

    let job = (await getJob(slot.id))!;
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.nextRunAt.getTime()).toBe(t0.getTime() + RETRY_BACKOFF_MS[0]);
    expect((await loadSlot(slot.id)).status).toBe('verifying');

    // 第 2、3 次：每次按当前 next_run_at 推进，并验证下一档退避
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      job = (await getJob(slot.id))!;
      const tickAt = new Date(job.nextRunAt.getTime() + 1_000);
      await scheduler.tick(tickAt);
      job = (await getJob(slot.id))!;
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(attempt);
      expect(job.nextRunAt.getTime()).toBe(tickAt.getTime() + RETRY_BACKOFF_MS[attempt - 1]);
    }
    expect((await loadSlot(slot.id)).status).toBe('verifying');
    expect(await notificationsFor(taker.id, 'delivery_rejected')).toHaveLength(0);

    // 第 4 次失败：manual + 人工原因，名额保持在 verifying
    job = (await getJob(slot.id))!;
    await scheduler.tick(new Date(job.nextRunAt.getTime() + 1_000));
    job = (await getJob(slot.id))!;
    expect(job.status).toBe('manual');
    expect(job.attempts).toBe(4);
    expect(job.lastError).toContain('rate limited');

    const row = await loadSlot(slot.id);
    expect(row.status).toBe('verifying');
    expect(row.manualReasons).toContain('verification_manual');
    expect(row.lastReject).toBeNull();
    expect(fakeScraper.getTweet).toHaveBeenCalledTimes(4);

    // manual 后不再被轮询
    await scheduler.tick(new Date(Date.now() + 24 * HOUR_MS));
    expect(fakeScraper.getTweet).toHaveBeenCalledTimes(4);
  });

  it('上游错误（XUpstreamError）同样抛给轮询器退避，而非直接打回', async () => {
    const { orderId } = await makeOrder({ slots: 1, requirements: { keywords: [] } });
    const { user: taker, binding } = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;
    await deliver(token, slot.id, tweetUrl(binding.handle)).expect(200);

    fakeScraper.getTweet.mockRejectedValue(new XUpstreamError('boom'));
    await scheduler.tick();

    const job = (await getJob(slot.id))!;
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect((await loadSlot(slot.id)).status).toBe('verifying');
  });

  it('人工放行 → 同通过路径；人工打回 → 回 reserved；重复处理被拒绝', async () => {
    const adminId = randomUUID();
    const { merchant, orderId } = await makeOrder({ slots: 2, requirements: { keywords: [] } });
    const takerA = await makeTaker();
    const takerB = await makeTaker();
    const tokenA = await signToken(takerA.user);
    const tokenB = await signToken(takerB.user);

    const slotA = (await take(tokenA, orderId).expect(201)).body;
    const slotB = (await take(tokenB, orderId).expect(201)).body;
    const deadlineB = slotB.deliverDeadlineAt;
    await deliver(tokenA, slotA.id, tweetUrl(takerA.binding.handle)).expect(200);
    await deliver(tokenB, slotB.id, tweetUrl(takerB.binding.handle)).expect(200);

    // 打回 B（任务尚未执行）：回 reserved、deadline 不变、通知接单方
    await verification.adminResolveDelivery(slotB.id, false, adminId);
    const rowB = await loadSlot(slotB.id);
    expect(rowB.status).toBe('reserved');
    expect(rowB.deliverDeadlineAt.toISOString()).toBe(new Date(deadlineB).toISOString());
    expect(rowB.lastReject?.reasons).toEqual(['manual_reject']);
    expect(rowB.lastReject?.adminId).toBe(adminId);
    expect(await notificationsFor(takerB.user.id, 'delivery_rejected')).toHaveLength(1);

    // 放行 A
    await verification.adminResolveDelivery(slotA.id, true, adminId);
    const rowA = await loadSlot(slotA.id);
    expect(rowA.status).toBe('passed');
    expect(rowA.confirmedDeadlineAt).toBeInstanceOf(Date);
    expect(rowA.confirmedDeadlineAt!.getTime()).toBeGreaterThan(Date.now() + 47 * HOUR_MS);
    expect(await notificationsFor(merchant.id, 'delivery_passed')).toHaveLength(1);

    // 遗留 pending 任务被 tick 消费时因状态已非 verifying 安全退出，不重复通知
    await scheduler.tick();
    expect((await getJob(slotA.id))?.status).toBe('done');
    expect((await getJob(slotB.id))?.status).toBe('done');
    expect(await notificationsFor(merchant.id, 'delivery_passed')).toHaveLength(1);
    expect(await notificationsFor(takerB.user.id, 'delivery_rejected')).toHaveLength(1);
    expect(await notificationsFor(takerA.user.id, 'delivery_rejected')).toHaveLength(0);

    // 非 verifying 状态不可再人工裁决
    await expect(verification.adminResolveDelivery(slotB.id, true, adminId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('申诉：仅 creator + 有 last_reject；标记 appeal_requested、通知本人、重复申诉幂等', async () => {
    const { taker, slotId } = await rejectSlot({ tweetText: 'missing keyword' });
    const token = await signToken(taker);

    const res = await request(server())
      .post(`/api/slots/${slotId}/appeal`)
      .set(auth(token))
      .expect(200);
    expect(res.body).toMatchObject({ appealRequested: true });

    const row = await loadSlot(slotId);
    expect(row.appealRequested).toBe(true);
    expect(row.status).toBe('reserved');

    const notes = await notificationsFor(taker.id, 'slot_appeal');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toContain('申诉');

    // 重复申诉：幂等，不重复通知
    await request(server())
      .post(`/api/slots/${row.id}/appeal`)
      .set(auth(token))
      .expect(200);
    expect(await notificationsFor(taker.id, 'slot_appeal')).toHaveLength(1);

    // 未登录 401
    await request(server()).post(`/api/slots/${row.id}/appeal`).expect(401);

    // 非本人 403
    const stranger = await makeUser();
    await request(server())
      .post(`/api/slots/${row.id}/appeal`)
      .set(auth(await signToken(stranger)))
      .expect(403);

    // 无 last_reject 不可申诉
    const { orderId } = await makeOrder({ slots: 1, requirements: { keywords: [] } });
    const fresh = await makeTaker();
    const freshToken = await signToken(fresh.user);
    const freshSlot = (await take(freshToken, orderId).expect(201)).body;
    const noReject = await request(server())
      .post(`/api/slots/${freshSlot.id}/appeal`)
      .set(auth(freshToken))
      .expect(400);
    expect(noReject.body.message).toContain('驳回');

    // 不存在 404 / 非 UUID 400
    await request(server())
      .post(`/api/slots/${randomUUID()}/appeal`)
      .set(auth(token))
      .expect(404);
    await request(server()).post('/api/slots/not-a-uuid/appeal').set(auth(token)).expect(400);
  });

  it('补偿扫描：verifying 但无 (pending/done/manual) delivery 任务 → 重新入队，且不重复入队', async () => {
    const { orderId } = await makeOrder({ slots: 1, requirements: { keywords: [] } });
    const { user: taker, binding } = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;
    await deliver(token, slot.id, tweetUrl(binding.handle)).expect(200);

    // 模拟事务外入队失败 / 进程崩溃：任务丢失
    await jobRepo.delete({ type: 'delivery', refId: slot.id });
    expect(await getJob(slot.id)).toBeNull();

    expect(await verification.sweepOrphanVerifying()).toBe(1);
    const job = await getJob(slot.id);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('pending');
    expect(job!.payload).toEqual({});

    // 已有任务 → 不重复
    expect(await verification.sweepOrphanVerifying()).toBe(0);

    // 重新入队的任务可以正常完成核验
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(binding.handle, 'ok'));
    await scheduler.tick();
    expect((await loadSlot(slot.id)).status).toBe('passed');
    expect((await getJob(slot.id))?.status).toBe('done');
  });

  it('URL 强化：非 X 域 / 非状态链接 400；twitter 变体规范化为 x.com；变体命中查重', async () => {
    const { orderId } = await makeOrder({ slots: 4, requirements: { keywords: [] } });
    const bad = await makeTaker();
    const first = await makeTaker();
    const second = await makeTaker();
    const dup = await makeTaker();
    const badToken = await signToken(bad.user);
    const firstToken = await signToken(first.user);
    const secondToken = await signToken(second.user);
    const dupToken = await signToken(dup.user);

    const badSlot = (await take(badToken, orderId).expect(201)).body;
    for (const url of [
      'https://example.com/alice/status/123',
      'https://x.com/alice',
      'https://x.com/alice/status/abc',
      'https://x.com/alice/status/123/photo/1',
      'not a url',
    ]) {
      const res = await deliver(badToken, badSlot.id, url).expect(400);
      expect(res.body.message).toBeTruthy();
    }
    let badRow = await loadSlot(badSlot.id);
    expect(badRow.status).toBe('reserved');
    expect(badRow.deliveryUrl).toBeNull();
    expect(await getJob(badSlot.id)).toBeNull();

    // twitter 手机域 + 大写 + 查询串 → 规范化为 x.com
    const slot1 = (await take(firstToken, orderId).expect(201)).body;
    const normalized = await deliver(
      firstToken,
      slot1.id,
      'https://mobile.twitter.com/SomeOne/status/1234500001/?s=20#top',
    ).expect(200);
    expect(normalized.body.deliveryUrl).toBe('https://x.com/someone/status/1234500001');
    expect((await loadSlot(slot1.id)).deliveryUrl).toBe(
      'https://x.com/someone/status/1234500001',
    );

    // 变体再次交付到另一个名额 → 规范化后命中唯一约束 409
    const slot2 = (await take(dupToken, orderId).expect(201)).body;
    await deliver(
      dupToken,
      slot2.id,
      'http://www.x.com/SOMEONE/status/1234500001?s=1',
    ).expect(409);

    // /i/web/status/<id> 保持该形式
    const slot3 = (await take(secondToken, orderId).expect(201)).body;
    const iweb = await deliver(
      secondToken,
      slot3.id,
      'https://twitter.com/i/web/status/99887766?lang=en',
    ).expect(200);
    expect(iweb.body.deliveryUrl).toBe('https://x.com/i/web/status/99887766');
  });

  it('推文级去重：handle 形式与 /i/web/ 形式指向同一推文 → 第二个 409', async () => {
    const { orderId } = await makeOrder({ slots: 2, requirements: { keywords: [] } });
    const first = await makeTaker();
    const second = await makeTaker();
    const tokenA = await signToken(first.user);
    const tokenB = await signToken(second.user);
    const slotA = (await take(tokenA, orderId).expect(201)).body;
    const slotB = (await take(tokenB, orderId).expect(201)).body;

    const tweetId = '812345678901234567';
    const delivered = await deliver(
      tokenA,
      slotA.id,
      `https://x.com/SomeOne/status/${tweetId}`,
    ).expect(200);
    expect(delivered.body.deliveryUrl).toBe(`https://x.com/someone/status/${tweetId}`);
    expect((await loadSlot(slotA.id)).deliveryTweetId).toBe(tweetId);

    // 不同 URL 字符串、同一推文 → 必须按 tweet id 拦截
    const conflict = await deliver(
      tokenB,
      slotB.id,
      `https://twitter.com/i/web/status/${tweetId}`,
    ).expect(409);
    expect(conflict.body.message).toContain('链接');

    const rowB = await loadSlot(slotB.id);
    expect(rowB.status).toBe('reserved');
    expect(rowB.deliveryUrl).toBeNull();
    expect(rowB.deliveryTweetId).toBeNull();
    expect(await getJob(slotB.id)).toBeNull();

    // DB 部分唯一索引兜底
    await expect(
      ds.query(`UPDATE "order_slots" SET "delivery_tweet_id" = $1 WHERE "id" = $2`, [
        tweetId,
        slotB.id,
      ]),
    ).rejects.toThrow(/uq_order_slots_delivery_tweet_id/);
  });

  it('补偿扫描只认当前交付轮次：旧 done job 不挡住新轮次，旧 job 也不能给新轮次盖 manual', async () => {
    const { orderId } = await makeOrder({ slots: 1, requirements: { keywords: ['alpha'] } });
    const { user: taker, binding } = await makeTaker();
    const token = await signToken(taker);
    const slot = (await take(token, orderId).expect(201)).body;

    // 第一轮：交付 → 打回，job1 变为 done
    await deliver(token, slot.id, tweetUrl(binding.handle)).expect(200);
    const firstJob = (await getJob(slot.id))!;
    fakeScraper.getTweet.mockResolvedValueOnce(makeTweet(binding.handle, 'no keyword'));
    await scheduler.tick();
    expect((await loadSlot(slot.id)).status).toBe('reserved');
    expect((await getJob(slot.id))!.status).toBe('done');

    // 第二轮：新链接 + 新任务；删除新任务模拟事务外入队失败
    const url2 = tweetUrl(binding.handle);
    await deliver(token, slot.id, url2).expect(200);
    const secondJob = (await getJob(slot.id))!;
    expect(secondJob.id).not.toBe(firstJob.id);
    expect(secondJob.status).toBe('pending');
    await jobRepo.delete({ id: secondJob.id });

    // job1（第一轮 done）created_at < 当前 delivered_at → 不能视为已覆盖
    expect(await verification.sweepOrphanVerifying()).toBe(1);
    const pendingJobs = await ds.getRepository(VerificationJob).find({
      where: { type: 'delivery', refId: slot.id, status: 'pending' },
    });
    expect(pendingJobs).toHaveLength(1);
    expect(pendingJobs[0].id).not.toBe(firstJob.id);

    // 模拟旧的 pending job 重试到第 4 次失败 → manual：不得给第二轮盖 verification_manual
    await jobRepo.update(
      { id: firstJob.id },
      { status: 'pending', attempts: 3, nextRunAt: new Date(Date.now() - 1_000) },
    );
    fakeScraper.getTweet.mockRejectedValue(new XRateLimitError('rate limited'));
    await scheduler.tick();

    const manualJob = await ds
      .getRepository(VerificationJob)
      .findOneOrFail({ where: { id: firstJob.id } });
    expect(manualJob.status).toBe('manual');

    const row = await loadSlot(slot.id);
    expect(row.status).toBe('verifying');
    expect(row.manualReasons).not.toContain('verification_manual');
  });
});
