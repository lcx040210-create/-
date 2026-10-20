import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { HDNodeWallet, Wallet } from 'ethers';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { User } from '../src/users/user.entity';

jest.setTimeout(30_000);

const REQUIRED_HEADINGS = [
  '服务说明',
  '违规定义与处置（含没收不予退还）',
  '免责声明',
  '争议处理',
];

describe('terms (e2e)（版本化服务条款 + 注册强制同意）', () => {
  let app: INestApplication;
  let ds: DataSource;
  let jwt: JwtService;
  let admin: User;
  let adminToken: string;
  /** 在 v1 阶段注册并同意 v1 的用户，用于验证条款升级后的旧版本拦截。 */
  let v1Wallet: HDNodeWallet;
  let v1UserId: string;

  const createdUserIds: string[] = [];
  const createdAddresses: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function currentTerms() {
    const res = await request(server()).get('/api/terms/current').expect(200);
    return res.body as {
      version: number;
      title: string;
      content_md: string;
      published_at: string;
    };
  }

  /** nonce → 签名 → verify；termsVersion 未传时不携带该字段。 */
  async function verifyWallet(
    wallet: Wallet | HDNodeWallet,
    termsVersion?: number,
  ) {
    const { body: nonceBody } = await request(server())
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(201);
    const signature = await wallet.signMessage(nonceBody.message);
    const payload: Record<string, unknown> = {
      address: wallet.address,
      signature,
    };
    if (termsVersion !== undefined) payload.termsVersion = termsVersion;
    return request(server()).post('/api/auth/verify').send(payload);
  }

  async function consentRows(userId: string): Promise<any[]> {
    return ds.query(
      `SELECT "terms_version", "agreed_at" FROM "user_consents"
        WHERE "user_id" = $1 ORDER BY "terms_version" ASC`,
      [userId],
    );
  }

  async function publishTerms(token: string | null, title: string, contentMd: string) {
    const req = request(server()).post('/api/admin/terms');
    if (token) req.set(auth(token));
    return req.send({ title, contentMd });
  }

  /** 把条款恢复成迁移预置的 v1 基线（包含失败重跑后的残留清理）。 */
  async function resetTerms(): Promise<void> {
    await ds.query(`DELETE FROM "terms" WHERE "version" > 1`);
    await ds.query(`UPDATE "terms" SET "is_current" = true WHERE "version" = 1`);
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();
    jwt = app.get(JwtService);

    await resetTerms();
    await ds.query(`DELETE FROM "admin_actions" WHERE "action" = 'terms_publish'`);

    admin = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress(),
        status: 'active',
        role: 'admin',
        passwordHash: null,
        nickname: null,
        ratingGrade: null,
      }),
    );
    createdUserIds.push(admin.id);
    adminToken = await jwt.signAsync(
      { sub: admin.id, role: 'admin' },
      { secret: process.env.JWT_SECRET, expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    try {
      if (ds?.isInitialized) {
        if (createdUserIds.length) {
          await ds.query(
            `DELETE FROM "user_consents" WHERE "user_id" = ANY($1::uuid[])`,
            [createdUserIds],
          );
          await ds.query(
            `DELETE FROM "refresh_tokens" WHERE "user_id" = ANY($1::uuid[])`,
            [createdUserIds],
          );
          await ds.query(`DELETE FROM "users" WHERE "id" = ANY($1::uuid[])`, [
            createdUserIds,
          ]);
        }
        if (createdAddresses.length) {
          await ds.query(`DELETE FROM "auth_nonces" WHERE "address" = ANY($1::varchar[])`, [
            createdAddresses,
          ]);
        }
        await resetTerms();
        await ds.query(`DELETE FROM "admin_actions" WHERE "action" = 'terms_publish'`);
      }
    } finally {
      await app?.close();
    }
  });

  it('GET /api/terms/current 公开返回 v1，正文含必备章节标题', async () => {
    const term = await currentTerms();
    expect(term).toMatchObject({
      version: 1,
      title: '用户协议与免责声明',
    });
    expect(term.published_at).toEqual(expect.any(String));
    for (const heading of REQUIRED_HEADINGS) {
      expect(term.content_md).toContain(heading);
    }
  });

  it('注册强制同意：不带/错误 termsVersion → 400；当前版本 → 201 且 consent 幂等落库', async () => {
    const wallet = Wallet.createRandom();
    v1Wallet = wallet;
    createdAddresses.push(wallet.address.toLowerCase());
    const current = await currentTerms();

    const missing = await verifyWallet(wallet);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('请先同意最新服务条款');

    const stale = await verifyWallet(wallet, current.version + 1000);
    expect(stale.status).toBe(400);
    expect(stale.body.message).toBe('请先同意最新服务条款');

    const ok = await verifyWallet(wallet, current.version);
    expect(ok.status).toBe(201);
    const userId = ok.body.user.id as string;
    createdUserIds.push(userId);
    v1UserId = userId;

    let rows = await consentRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].terms_version).toBe(current.version);
    const firstAgreedAt = rows[0].agreed_at;

    // 重复 verify（登录）不重复写 consent，agreed_at 保持不变。
    const again = await verifyWallet(wallet, current.version);
    expect(again.status).toBe(201);
    rows = await consentRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].agreed_at).toEqual(firstAgreedAt);
  });

  it('发布新版本：非 admin → 403；admin 发布 v2 后旧版置非当前、审计落库', async () => {
    const wallet = Wallet.createRandom();
    createdAddresses.push(wallet.address.toLowerCase());
    const current = await currentTerms();
    const login = await verifyWallet(wallet, current.version);
    expect(login.status).toBe(201);
    createdUserIds.push(login.body.user.id);

    const forbidden = await publishTerms(
      login.body.accessToken,
      '用户协议 v2',
      '# v2 正文',
    );
    expect(forbidden.status).toBe(403);

    const unauthenticated = await publishTerms(null, '用户协议 v2', '# v2 正文');
    expect(unauthenticated.status).toBe(401);

    const published = await publishTerms(
      adminToken,
      '用户协议 v2',
      '# 用户协议 v2\n\n## 服务说明\n\n## 违规定义与处置（含没收不予退还）\n\n## 免责声明\n\n## 争议处理\n',
    );
    expect(published.status).toBe(201);
    expect(published.body).toMatchObject({
      version: current.version + 1,
      title: '用户协议 v2',
      content_md: expect.stringContaining('服务说明'),
    });

    const latest = await currentTerms();
    expect(latest.version).toBe(current.version + 1);
    expect(latest.title).toBe('用户协议 v2');

    const rows: Array<{ version: number; is_current: boolean }> = await ds.query(
      `SELECT "version", "is_current" FROM "terms" WHERE "version" IN ($1, $2) ORDER BY "version"`,
      [current.version, current.version + 1],
    );
    expect(rows).toEqual([
      { version: current.version, is_current: false },
      { version: current.version + 1, is_current: true },
    ]);

    const currentCount: Array<{ count: string }> = await ds.query(
      `SELECT COUNT(*)::text AS count FROM "terms" WHERE "is_current" = true`,
    );
    expect(currentCount[0].count).toBe('1');

    const audits: any[] = await ds.query(
      `SELECT "action", "target_type", "target_id", "detail"
         FROM "admin_actions" WHERE "action" = 'terms_publish'`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'terms_publish',
      target_type: 'terms',
      target_id: published.body.id,
    });
    expect(audits[0].detail).toMatchObject({ version: current.version + 1 });
  });

  it('条款升级后：旧版本 verify 被拒；新版本通过且新旧用户都只写一条 v2 consent', async () => {
    const latest = await currentTerms();
    expect(latest.version).toBe(2);

    // 已有用户（第 2 个 it 中已同意 v1）：旧版本 → 400。
    expect((await consentRows(v1UserId)).map((row) => row.terms_version)).toEqual([1]);

    const staleLogin = await verifyWallet(v1Wallet, 1);
    expect(staleLogin.status).toBe(400);
    expect(staleLogin.body.message).toBe('请先同意最新服务条款');

    const upgraded = await verifyWallet(v1Wallet, 2);
    expect(upgraded.status).toBe(201);
    expect(upgraded.body.user.id).toBe(v1UserId);
    let rows = await consentRows(v1UserId);
    expect(rows.map((row) => row.terms_version)).toEqual([1, 2]);
    const v2AgreedAt = rows.find((row) => row.terms_version === 2)!.agreed_at;

    // 再次用 v2 登录：不重复写 v2 consent。
    const repeat = await verifyWallet(v1Wallet, 2);
    expect(repeat.status).toBe(201);
    rows = await consentRows(v1UserId);
    expect(rows.map((row) => row.terms_version)).toEqual([1, 2]);
    expect(rows.find((row) => row.terms_version === 2)!.agreed_at).toEqual(v2AgreedAt);

    // 新用户：v1 → 400，v2 → 201，且只有一条 v2 consent。
    const newWallet = Wallet.createRandom();
    createdAddresses.push(newWallet.address.toLowerCase());
    const newStale = await verifyWallet(newWallet, 1);
    expect(newStale.status).toBe(400);

    const newOk = await verifyWallet(newWallet, 2);
    expect(newOk.status).toBe(201);
    const newUserId = newOk.body.user.id as string;
    createdUserIds.push(newUserId);
    rows = await consentRows(newUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].terms_version).toBe(2);
  });
});
