import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HDNodeWallet, Wallet } from 'ethers';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app.close());

  async function login(wallet: Wallet | HDNodeWallet) {
    const { body: nonceBody } = await request(app.getHttpServer())
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(201);
    const signature = await wallet.signMessage(nonceBody.message);
    const { body: verified } = await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ address: wallet.address, signature })
      .expect(201);
    return { nonceBody, signature, verified };
  }

  it('完整流程：nonce → verify 注册 → me', async () => {
    const wallet = Wallet.createRandom();
    const { verified } = await login(wallet);

    expect(verified.accessToken).toEqual(expect.any(String));
    expect(verified.refreshToken).toEqual(expect.any(String));
    expect(verified.user).toMatchObject({
      address: wallet.address.toLowerCase(),
      status: 'pending_x_binding',
      role: 'user',
      rating_grade: null,
    });

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .expect(200);

    expect(me.body).toMatchObject({
      id: verified.user.id,
      address: wallet.address.toLowerCase(),
      status: 'pending_x_binding',
      role: 'user',
      rating_grade: null,
    });
  });

  it('nonce 一次性：复用被拒', async () => {
    const wallet = Wallet.createRandom();
    const { signature } = await login(wallet);

    // 复用第一次 verify 用过的 nonce + 签名
    await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ address: wallet.address, signature })
      .expect(401);
  });

  it('错误签名被拒', async () => {
    const wallet = Wallet.createRandom();
    const impostor = Wallet.createRandom();
    const { body: nonceBody } = await request(app.getHttpServer())
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(201);
    const signature = await impostor.signMessage(nonceBody.message);

    await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ address: wallet.address, signature })
      .expect(401);
  });

  it('refresh 轮换：旧 refresh 立即失效', async () => {
    const wallet = Wallet.createRandom();
    const { verified } = await login(wallet);

    const { body: rotated } = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: verified.refreshToken })
      .expect(201);
    expect(rotated.refreshToken).not.toBe(verified.refreshToken);

    // 旧 refresh 已被轮换作废
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: verified.refreshToken })
      .expect(401);

    // 新 refresh 可继续轮换
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.refreshToken })
      .expect(201);
  });
});
