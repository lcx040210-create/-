import { DataSource } from 'typeorm';
import dataSourceForTest from '../src/config/database.config';

describe('migrations', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = dataSourceForTest;
    if (!ds.isInitialized) await ds.initialize();
    await ds.runMigrations();
    // 保持测试可重复运行
    await ds.query(`DELETE FROM users WHERE address = '0xabc'`);
  });
  afterAll(async () => ds.destroy());

  it('users 表可读写', async () => {
    const repo = ds.getRepository('users');
    await repo.insert({
      id: '11111111-1111-1111-1111-111111111111',
      address: '0xabc',
      status: 'pending_x_binding',
      role: 'user',
    });
    const row: any = await repo.findOne({ where: { address: '0xabc' } });
    expect(row.status).toBe('pending_x_binding');
  });
});
