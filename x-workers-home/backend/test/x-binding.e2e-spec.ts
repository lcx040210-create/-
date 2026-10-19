import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Wallet } from 'ethers';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthNonce } from '../src/auth/entities/auth-nonce.entity';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { BindingChange } from '../src/bindings/binding-change.entity';
import { BindingsService, buildWalletChangeMessage } from '../src/bindings/bindings.service';
import { XBinding } from '../src/bindings/x-binding.entity';
import { configureApp } from '../src/bootstrap';
import { VerificationJob } from '../src/jobs/verification-job.entity';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { Notification } from '../src/notifications/notification.entity';
import { User } from '../src/users/user.entity';
import { XNotFoundError, XScraperService } from '../src/xscraper/xscraper.service';

const fakeScraper = {
  getProfile: jest.fn(),
  getRecentTweets: jest.fn(),
  getTweet: jest.fn(),
};

describe('X binding + scheduler + notifications + binding changes (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let scheduler: SchedulerService;
  let bindings: BindingsService;

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
    const verified = await request(server())
      .post('/api/auth/verify')
      .send({ address: wallet.address, signature })
      .expect(201);
    createdUserIds.push(verified.body.user.id);
    createdAddresses.push(wallet.address.toLowerCase());
    return { wallet, token: verified.body.accessToken as string, userId: verified.body.user.id as string };
  }

  async function startBinding(token: string, handle: string) {
    const res = await request(server())
      .post('/api/bindings/x/start')
      .set(auth(token))
      .send({ handle })
      .expect(201);
    return res.body as { code: string; handle: string };
  }

  async function bindingStatus(token: string) {
    const res = await request(server())
      .get('/api/bindings/x/status')
      .set(auth(token))
      .expect(200);
    return res.body as { status: string; handle: string | null };
  }

  async function notifications(token: string) {
    const res = await request(server())
      .get('/api/notifications')
      .set(auth(token))
      .expect(200);
    return res.body as { items: any[]; total: number; limit: number; offset: number };
  }

  async function jobFor(userId: string) {
    return ds.getRepository(VerificationJob).findOne({
      where: { type: 'x_binding', refId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async function bindWithBio(token: string, handle: string, code: string) {
    fakeScraper.getProfile.mockResolvedValue({ handle, bio: `hello ${code.toLowerCase()}` });
    await scheduler.tick(new Date(Date.now() + 1000));
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
    bindings = app.get(BindingsService);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (createdUserIds.length) {
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

  it('bio 含验证码 → 绑定成功且用户 active', async () => {
    const { token, userId } = await registerUser();

    const before = await bindingStatus(token);
    expect(before).toEqual({ status: 'none', handle: null });

    const handle = uniqueHandle('alice');
    const started = await startBinding(token, `@${handle.toUpperCase()}`);
    expect(started.code).toMatch(/^XWH-[0-9A-F]{6}$/);
    expect(started.handle).toBe(handle);

    // 大小写不敏感
    await bindWithBio(token, handle, started.code);

    expect(await bindingStatus(token)).toEqual({ status: 'active', handle });

    const binding = await ds.getRepository(XBinding).findOneOrFail({ where: { userId } });
    expect(binding.status).toBe('active');
    expect(binding.verifiedAt).toBeInstanceOf(Date);

    const user = await ds.getRepository(User).findOneOrFail({ where: { id: userId } });
    expect(user.status).toBe('active');

    const me = await request(server()).get('/api/auth/me').set(auth(token)).expect(200);
    expect(me.body).toMatchObject({
      id: userId,
      status: 'active',
      x_binding: { status: 'active', handle },
    });

    const job = await jobFor(userId);
    expect(job).toMatchObject({ status: 'done', attempts: 1 });
    expect(fakeScraper.getRecentTweets).not.toHaveBeenCalled();
  });

  it('最近推文含验证码 → 绑定成功', async () => {
    const { token, userId } = await registerUser();
    const handle = uniqueHandle('bob');
    const started = await startBinding(token, handle);
    const startedAt = Date.now();

    fakeScraper.getProfile.mockResolvedValue({ handle, bio: 'no code here' });

    // start 之前的推文即使含验证码也不作数
    fakeScraper.getRecentTweets.mockResolvedValue([
      { id: '1', text: `verify ${started.code}`, created_at: new Date(startedAt - 60_000).toISOString() },
    ]);
    await scheduler.tick(new Date(startedAt + 2000));
    expect((await bindingStatus(token)).status).toBe('pending');

    // start 之后发的推文 → 绑定成功
    fakeScraper.getRecentTweets.mockResolvedValue([
      { id: '2', text: `verify ${started.code.toLowerCase()}`, created_at: new Date(startedAt + 1000).toISOString() },
    ]);
    await scheduler.tick(new Date(startedAt + 65_000));

    expect(await bindingStatus(token)).toEqual({ status: 'active', handle });
    expect(fakeScraper.getRecentTweets).toHaveBeenCalledWith(handle, 5);
  });

  it('未匹配 → 重试入队（attempts+1，next_run_at 后移）', async () => {
    const { token, userId } = await registerUser();
    const handle = uniqueHandle('retry');
    await startBinding(token, handle);

    fakeScraper.getProfile.mockResolvedValue({ handle, bio: 'nothing to see' });
    fakeScraper.getRecentTweets.mockResolvedValue([]);

    const t0 = Date.now();
    await scheduler.tick(new Date(t0 + 1000));

    let job = await jobFor(userId);
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    const firstNext = job!.nextRunAt.getTime();
    expect(firstNext).toBeGreaterThanOrEqual(t0 + 1000 + 60_000 - 10);
    expect(job!.lastError).toContain('验证码未匹配');

    // 未到期不会重复执行
    await scheduler.tick(new Date(t0 + 1000));
    job = await jobFor(userId);
    expect(job!.attempts).toBe(1);

    // 到期后第二次执行
    await scheduler.tick(new Date(firstNext + 1));
    job = await jobFor(userId);
    expect(job!.status).toBe('pending');
    expect(job!.attempts).toBe(2);
    expect(job!.nextRunAt.getTime()).toBeGreaterThan(firstNext);

    expect((await bindingStatus(token)).status).toBe('pending');
  });

  it('XNotFoundError 走重试（不是直接 manual）', async () => {
    const { token, userId } = await registerUser();
    await startBinding(token, uniqueHandle('nf'));
    fakeScraper.getProfile.mockRejectedValue(new XNotFoundError('没找到这个账号'));

    await scheduler.tick(new Date(Date.now() + 1000));

    const job = await jobFor(userId);
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job!.lastError).toContain('没找到');
  });

  it('4 次失败 → job/绑定 manual，并落失败通知', async () => {
    const { token, userId } = await registerUser();
    const handle = uniqueHandle('manual');
    await startBinding(token, handle);

    fakeScraper.getProfile.mockResolvedValue({ handle, bio: 'no code' });
    fakeScraper.getRecentTweets.mockResolvedValue([]);

    const t0 = Date.now();
    for (let i = 1; i <= 4; i += 1) {
      await scheduler.tick(new Date(t0 + i * 31 * 60_000));
    }

    const job = await jobFor(userId);
    expect(job).toMatchObject({ status: 'manual', attempts: 4 });
    expect(job!.lastError).toContain('验证码未匹配');

    expect(await bindingStatus(token)).toEqual({ status: 'manual_review', handle });

    const list = await notifications(token);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'x_binding_failed' });
  });

  it('handle 已被别的账号绑定 → 409', async () => {
    const first = await registerUser();
    const second = await registerUser();
    const handle = uniqueHandle('dupe');

    await startBinding(first.token, handle);
    await request(server())
      .post('/api/bindings/x/start')
      .set(auth(second.token))
      .send({ handle: handle.toUpperCase() })
      .expect(409);

    // 本人重新发起 pending 绑定允许（刷新验证码）
    const restarted = await startBinding(first.token, handle);
    expect(restarted.code).not.toBe('');
    const binding = await ds
      .getRepository(XBinding)
      .findOneOrFail({ where: { userId: first.userId } });
    expect(binding.handle).toBe(handle);
  });

  it('改绑流程：申请后提现拦截状态可查；admin 通过且 24h 后新地址生效', async () => {
    const { wallet, token, userId } = await registerUser();
    const newWallet = Wallet.createRandom();

    const message = buildWalletChangeMessage(wallet.address, newWallet.address);
    const signature = await newWallet.signMessage(message);

    const changeRes = await request(server())
      .post('/api/bindings/wallet/change')
      .set(auth(token))
      .send({ newAddress: newWallet.address, signature })
      .expect(201);

    expect(changeRes.body).toMatchObject({
      kind: 'wallet',
      newValue: newWallet.address.toLowerCase(),
      status: 'pending',
    });
    expect(changeRes.body.message).toBe(message);
    const effectiveAt = new Date(changeRes.body.effectiveAt).getTime();
    expect(effectiveAt).toBeGreaterThanOrEqual(Date.now() + 23 * 60 * 60 * 1000);

    const changes = await request(server())
      .get('/api/bindings/changes')
      .set(auth(token))
      .expect(200);
    expect(changes.body).toHaveLength(1);
    expect(changes.body[0]).toMatchObject({ kind: 'wallet', status: 'pending' });

    // T9 提现拦截所依赖的查询
    expect(await bindings.hasPendingChange(userId)).toBe(true);
    expect(await bindings.hasPendingChange(userId, 'wallet')).toBe(true);
    expect(await bindings.hasPendingChange(userId, 'x')).toBe(false);

    // 重复申请 → 409
    await request(server())
      .post('/api/bindings/wallet/change')
      .set(auth(token))
      .send({ newAddress: newWallet.address, signature })
      .expect(409);

    // 错误签名 → 400
    const impostor = Wallet.createRandom();
    const badSig = await impostor.signMessage(message);
    await request(server())
      .post('/api/bindings/wallet/change')
      .set(auth(token))
      .send({ newAddress: newWallet.address, signature: badSig })
      .expect(400);

    // T17 审核通过
    await ds.getRepository(BindingChange).update({ id: changeRes.body.id }, { status: 'approved' });

    // 未到 24h 不生效
    await bindings.applyDueChanges(new Date(effectiveAt - 60_000));
    let user = await ds.getRepository(User).findOneOrFail({ where: { id: userId } });
    expect(user.address).toBe(wallet.address.toLowerCase());

    // 到期生效
    await bindings.applyDueChanges(new Date(effectiveAt + 1000));
    user = await ds.getRepository(User).findOneOrFail({ where: { id: userId } });
    expect(user.address).toBe(newWallet.address.toLowerCase());
    expect(await bindings.hasPendingChange(userId)).toBe(false);

    const me = await request(server()).get('/api/auth/me').set(auth(token)).expect(200);
    expect(me.body.address).toBe(newWallet.address.toLowerCase());

    const list = await notifications(token);
    expect(list.items.some((n) => n.kind === 'binding_change_applied')).toBe(true);
  });

  it('X 改绑：验证码通过生成 pending change，审核+24h 后换绑', async () => {
    const { token, userId } = await registerUser();
    const handle = uniqueHandle('xold');
    const newHandle = uniqueHandle('xnew');

    const initial = await startBinding(token, handle);
    await bindWithBio(token, handle, initial.code);
    expect((await bindingStatus(token)).status).toBe('active');

    const changeRes = await request(server())
      .post('/api/bindings/x/change')
      .set(auth(token))
      .send({ handle: newHandle })
      .expect(201);
    expect(changeRes.body.code).toMatch(/^XWH-[0-9A-F]{6}$/);

    fakeScraper.getProfile.mockResolvedValue({ handle: newHandle, bio: changeRes.body.code });
    fakeScraper.getRecentTweets.mockResolvedValue([]);
    await scheduler.tick(new Date(Date.now() + 1000));

    const changes = await request(server())
      .get('/api/bindings/changes')
      .set(auth(token))
      .expect(200);
    expect(changes.body).toHaveLength(1);
    expect(changes.body[0]).toMatchObject({ kind: 'x', newValue: newHandle, status: 'pending' });
    const changeId = changes.body[0].id;
    const effectiveAt = new Date(changes.body[0].effectiveAt).getTime();

    // 冷静期内旧 handle 仍然有效
    expect(await bindingStatus(token)).toEqual({ status: 'active', handle });
    expect(await bindings.hasPendingChange(userId, 'x')).toBe(true);

    await ds.getRepository(BindingChange).update({ id: changeId }, { status: 'approved' });
    await bindings.applyDueChanges(new Date(effectiveAt + 1000));

    expect(await bindingStatus(token)).toEqual({ status: 'active', handle: newHandle });
    expect(await bindings.hasPendingChange(userId, 'x')).toBe(false);
    const binding = await ds.getRepository(XBinding).findOneOrFail({ where: { userId } });
    expect(binding.handle).toBe(newHandle);
  });

  it('通知基座：绑定成功/失败各落一条；仅本人可标记已读', async () => {
    // 成功
    const success = await registerUser();
    const successHandle = uniqueHandle('ns');
    const started = await startBinding(success.token, successHandle);
    await bindWithBio(success.token, successHandle, started.code);

    const successList = await notifications(success.token);
    expect(successList.items).toHaveLength(1);
    expect(successList.items[0]).toMatchObject({ kind: 'x_binding_success', readAt: null });

    const read = await request(server())
      .post(`/api/notifications/${successList.items[0].id}/read`)
      .set(auth(success.token))
      .expect(200);
    expect(read.body.readAt).toEqual(expect.any(String));

    // 失败（4 次未匹配）
    const failed = await registerUser();
    const failHandle = uniqueHandle('nf');
    await startBinding(failed.token, failHandle);
    fakeScraper.getProfile.mockResolvedValue({ handle: failHandle, bio: 'no code' });
    fakeScraper.getRecentTweets.mockResolvedValue([]);
    const t0 = Date.now();
    for (let i = 1; i <= 4; i += 1) {
      await scheduler.tick(new Date(t0 + i * 31 * 60_000));
    }

    const failList = await notifications(failed.token);
    expect(failList.items).toHaveLength(1);
    expect(failList.items[0]).toMatchObject({ kind: 'x_binding_failed' });
    expect(failList.items[0].body).toContain(failHandle);

    // 他人的通知不可标记已读
    await request(server())
      .post(`/api/notifications/${successList.items[0].id}/read`)
      .set(auth(failed.token))
      .expect(404);
  });
});
