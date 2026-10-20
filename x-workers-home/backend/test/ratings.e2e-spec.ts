import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Wallet } from 'ethers';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthNonce } from '../src/auth/entities/auth-nonce.entity';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { BindingChange } from '../src/bindings/binding-change.entity';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { VerificationJob } from '../src/jobs/verification-job.entity';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { Notification } from '../src/notifications/notification.entity';
import { RatingsService } from '../src/ratings/ratings.service';
import { UserRating } from '../src/ratings/user-rating.entity';
import { User } from '../src/users/user.entity';
import { XScraperService, XUpstreamError } from '../src/xscraper/xscraper.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const fakeScraper = {
  getProfile: jest.fn(),
  getRecentTweets: jest.fn(),
  getTweet: jest.fn(),
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** 与 rating.spec.ts 钉死用例一致：20 条 × views=20000 / 互动 400 → rate 2% */
function pinnedTweets() {
  return Array.from({ length: 20 }, () => ({
    id: `t${Math.random().toString(36).slice(2, 10)}`,
    views: 20000,
    likes: 300,
    reposts: 50,
    replies: 50,
    bookmarks: 0,
    text: 'gm',
    created_at: new Date().toISOString(),
  }));
}

describe('账户评级 e2e（绑定初评 + 公开查询 + 周刷新）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let scheduler: SchedulerService;
  let ratings: RatingsService;

  const createdUserIds: string[] = [];
  const createdAddresses: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function uniqueHandle(prefix: string): string {
    return `${prefix}${Math.random().toString(36).slice(2, 8)}`.slice(0, 15);
  }

  async function registerUser() {
    const wallet = Wallet.createRandom();
    const nonce = await request(server())
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(201);
    const signature = await wallet.signMessage(nonce.body.message);
    const terms = await request(server()).get('/api/terms/current').expect(200);
    const verified = await request(server())
      .post('/api/auth/verify')
      .send({ address: wallet.address, signature, termsVersion: terms.body.version })
      .expect(201);
    createdUserIds.push(verified.body.user.id);
    createdAddresses.push(wallet.address.toLowerCase());
    return {
      wallet,
      token: verified.body.accessToken as string,
      userId: verified.body.user.id as string,
    };
  }

  async function startBinding(token: string, handle: string) {
    const res = await request(server())
      .post('/api/bindings/x/start')
      .set(auth(token))
      .send({ handle })
      .expect(201);
    return res.body as { code: string; handle: string };
  }

  /**
   * 注册 → 发起绑定 → 用 bio 验证码通过 → 触发绑定初评。
   * tweetsError 用于模拟评级抓取失败（验证阶段走 bio，不依赖推文）。
   */
  async function bindAndRate(options: {
    profile?: Record<string, unknown>;
    tweets?: unknown[];
    tweetsError?: Error;
  } = {}) {
    const { token, userId } = await registerUser();
    const handle = uniqueHandle('rate');
    const started = await startBinding(token, handle);

    fakeScraper.getProfile.mockResolvedValue({
      handle,
      bio: `verify ${started.code}`,
      followers: 10000,
      following: 1000,
      joined: isoDaysAgo(1825),
      ...options.profile,
    });
    if (options.tweetsError) {
      fakeScraper.getRecentTweets.mockRejectedValue(options.tweetsError);
    } else {
      fakeScraper.getRecentTweets.mockResolvedValue(options.tweets ?? pinnedTweets());
    }

    await scheduler.tick(new Date(Date.now() + 1000));
    return { token, userId, handle, code: started.code };
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
    scheduler = app.get(SchedulerService);
    ratings = app.get(RatingsService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (createdUserIds.length) {
        await ds.getRepository(UserRating).delete({ userId: In(createdUserIds) });
        await ds.getRepository(Notification).delete({ userId: In(createdUserIds) });
        await ds.getRepository(BindingChange).delete({ userId: In(createdUserIds) });
        await ds.getRepository(XBinding).delete({ userId: In(createdUserIds) });
        await ds.getRepository(VerificationJob).delete({ refId: In(createdUserIds) });
        await ds.getRepository(RefreshToken).delete({ userId: In(createdUserIds) });
        await ds.getRepository(User).delete({ id: In(createdUserIds) });
      }
      if (createdAddresses.length) {
        await ds.getRepository(AuthNonce).delete({ address: In(createdAddresses) });
      }
    }
    await app.close();
  });

  beforeEach(() => {
    fakeScraper.getProfile.mockReset();
    fakeScraper.getRecentTweets.mockReset();
    fakeScraper.getTweet.mockReset();
  });

  it('绑定激活后落 user_ratings、同步 users.rating_grade，公开端点可读', async () => {
    const { token, userId, handle } = await bindAndRate();

    // 绑定本身成功
    const status = await request(server())
      .get('/api/bindings/x/status')
      .set(auth(token))
      .expect(200);
    expect(status.body).toEqual({ status: 'active', handle });

    // 初评：钉死用例 69 / B
    const row = await ds.getRepository(UserRating).findOneOrFail({ where: { userId } });
    expect(row.score).toBe(69);
    expect(row.grade).toBe('B');
    expect(row.flags).toEqual([]);
    expect(row.computedAt).toBeInstanceOf(Date);
    expect(row.breakdown).toMatchObject({
      followers: 0.6667,
      avg_views: 0.782,
      engagement: 0.4,
      age: 1,
      ratio: 0.9,
    });

    const user = await ds.getRepository(User).findOneOrFail({ where: { id: userId } });
    expect(user.ratingGrade).toBe('B');

    // 公开端点：大小写不敏感
    const res = await request(server())
      .get(`/api/ratings/${handle.toUpperCase()}`)
      .expect(200);
    expect(res.body).toMatchObject({
      handle,
      score: 69,
      grade: 'B',
      flags: [],
      breakdown: { followers: 0.6667, avg_views: 0.782, engagement: 0.4, age: 1, ratio: 0.9 },
    });
    expect(res.body.computed_at).toEqual(expect.any(String));
    expect(new Date(res.body.computed_at).toString()).not.toBe('Invalid Date');

    // 未绑定/未评级的 handle → 404
    await request(server()).get('/api/ratings/nobody_here').expect(404);
  });

  it('评级失败不影响绑定成功（job 完成、无评级行）', async () => {
    const { token, userId, handle } = await bindAndRate({
      tweetsError: new XUpstreamError('评级抓取爆了'),
    });

    const status = await request(server())
      .get('/api/bindings/x/status')
      .set(auth(token))
      .expect(200);
    expect(status.body).toEqual({ status: 'active', handle });

    expect(await ds.getRepository(UserRating).findOne({ where: { userId } })).toBeNull();
    const user = await ds.getRepository(User).findOneOrFail({ where: { id: userId } });
    expect(user.ratingGrade).toBeNull();

    const job = await ds.getRepository(VerificationJob).findOne({
      where: { type: 'x_binding', refId: userId },
      order: { createdAt: 'DESC' },
    });
    expect(job).toMatchObject({ status: 'done' });

    await request(server()).get(`/api/ratings/${handle}`).expect(404);
  });

  it('refreshAll：顺序刷新 active 用户，评级与 users.rating_grade 同步更新', async () => {
    const { userId, handle } = await bindAndRate();
    let row = await ds.getRepository(UserRating).findOneOrFail({ where: { userId } });
    expect(row.grade).toBe('B');

    // 数据变差（0 粉、无推文、账号新）→ D
    fakeScraper.getProfile.mockResolvedValue({
      handle,
      bio: 'no code now',
      followers: 0,
      following: 0,
      joined: isoDaysAgo(30),
    });
    fakeScraper.getRecentTweets.mockResolvedValue([]);

    const stats = await ratings.refreshAll();
    expect(stats.refreshed).toBeGreaterThanOrEqual(1);

    row = await ds.getRepository(UserRating).findOneOrFail({ where: { userId } });
    expect(row.grade).toBe('D');
    expect(row.score).toBeLessThan(40);

    const user = await ds.getRepository(User).findOneOrFail({ where: { id: userId } });
    expect(user.ratingGrade).toBe('D');

    // 公开端点读到的是刷新后的值
    const res = await request(server()).get(`/api/ratings/${handle}`).expect(200);
    expect(res.body).toMatchObject({ score: row.score, grade: 'D' });
  });
});
