import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MICRO } from '../src/common/money';
import { Account } from '../src/ledger/account.entity';
import { LedgerEntry } from '../src/ledger/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { User } from '../src/users/user.entity';

const XM = MICRO;

describe('GET /api/ledger/mine（余额 + 本人近 50 条流水）e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let jwt: JwtService;

  const createdUserIds: string[] = [];

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function randomAddress(): string {
    return `0x${(randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40)}`;
  }

  async function makeUser(): Promise<User> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        address: randomAddress().toLowerCase(),
        status: 'active',
        role: 'user',
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

  async function credit(userId: string, amountMicro: bigint): Promise<string> {
    const refId = randomUUID();
    await ds.transaction((tx) =>
      ledger.credit(tx, {
        userId,
        amountMicro,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: refId },
      }),
    );
    return refId;
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

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (createdUserIds.length) {
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

  it('余额正确（可用/冻结），流水仅含本人且按时间倒序、金额带符号', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    const depositRef = await credit(alice.id, 100n * XM);
    const holdRef = randomUUID();
    await ds.transaction((tx) =>
      ledger.freezeAvailable(tx, {
        userId: alice.id,
        amountMicro: 20n * XM,
        kind: 'withdrawal_hold',
        ref: { type: 'withdrawal', id: holdRef },
      }),
    );
    const payoutRef = randomUUID();
    await ds.transaction((tx) =>
      ledger.transfer(tx, {
        from: { userId: alice.id },
        to: { userId: bob.id },
        amountMicro: 10n * XM,
        kind: 'slot_payout',
        ref: { type: 'order', id: payoutRef },
      }),
    );

    // 固定时间顺序：充值 3 分钟前 → 冻结 2 分钟前 → 转账 1 分钟前
    await ds.query(`UPDATE "ledger_entries" SET "created_at" = now() - interval '3 min' WHERE "ref_id" = $1`, [depositRef]);
    await ds.query(`UPDATE "ledger_entries" SET "created_at" = now() - interval '2 min' WHERE "ref_id" = $1`, [holdRef]);
    await ds.query(`UPDATE "ledger_entries" SET "created_at" = now() - interval '1 min' WHERE "ref_id" = $1`, [payoutRef]);

    const token = await signToken(alice);
    const res = await request(server())
      .get('/api/ledger/mine')
      .set(auth(token))
      .expect(200);

    expect(res.body.availableXm).toBe('70');
    expect(res.body.frozenXm).toBe('20');
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries.map((entry: any) => entry.kind)).toEqual([
      'slot_payout',
      'withdrawal_hold',
      'deposit_credit',
    ]);
    expect(res.body.entries.map((entry: any) => entry.amountXm)).toEqual(['-10', '-20', '100']);
    expect(res.body.entries[0]).toMatchObject({
      kind: 'slot_payout',
      refType: 'order',
      refId: payoutRef,
      amountXm: '-10',
    });
    expect(res.body.entries[1]).toMatchObject({
      kind: 'withdrawal_hold',
      refType: 'withdrawal',
      refId: holdRef,
      amountXm: '-20',
    });
    expect(res.body.entries[2]).toMatchObject({
      kind: 'deposit_credit',
      refType: 'deposit',
      refId: depositRef,
      amountXm: '100',
    });
    expect(res.body.entries[0].createdAt).toEqual(expect.any(String));

    // 对方只看到自己的流水（+10 一笔），看不到 alice 的充值/冻结
    const bobToken = await signToken(bob);
    const bobRes = await request(server())
      .get('/api/ledger/mine')
      .set(auth(bobToken))
      .expect(200);
    expect(bobRes.body.availableXm).toBe('10');
    expect(bobRes.body.frozenXm).toBe('0');
    expect(bobRes.body.entries).toHaveLength(1);
    expect(bobRes.body.entries[0]).toMatchObject({
      kind: 'slot_payout',
      refId: payoutRef,
      amountXm: '10',
    });

    // 未登录 401
    await request(server()).get('/api/ledger/mine').expect(401);
  });

  it('无账户用户返回 0 余额与空流水；最近 50 条上限', async () => {
    const lonely = await makeUser();
    const lonelyToken = await signToken(lonely);
    const emptyRes = await request(server())
      .get('/api/ledger/mine')
      .set(auth(lonelyToken))
      .expect(200);
    expect(emptyRes.body).toEqual({ availableXm: '0', frozenXm: '0', entries: [] });

    const busy = await makeUser();
    for (let i = 0; i < 55; i++) {
      await credit(busy.id, XM);
    }
    const busyAccount = await ds
      .getRepository(Account)
      .findOneOrFail({ where: { ownerUserId: busy.id } });
    // 把既有流水压到 1 小时前，再写一条最新流水，验证「最近」排序。
    await ds.query(`UPDATE "ledger_entries" SET "created_at" = now() - interval '1 hour' WHERE "account_id" = $1`, [
      busyAccount.id,
    ]);
    const latestRef = await credit(busy.id, XM);

    const busyToken = await signToken(busy);
    const res = await request(server())
      .get('/api/ledger/mine')
      .set(auth(busyToken))
      .expect(200);

    expect(res.body.availableXm).toBe('56');
    expect(res.body.frozenXm).toBe('0');
    expect(res.body.entries).toHaveLength(50);
    expect(res.body.entries[0]).toMatchObject({
      kind: 'deposit_credit',
      refId: latestRef,
      amountXm: '1',
    });
  });
});
