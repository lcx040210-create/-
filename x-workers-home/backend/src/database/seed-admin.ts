import * as bcrypt from 'bcrypt';
import dataSource from '../config/database.config';

async function seed() {
  const address = (process.env.ADMIN_ADDRESS || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!address || !password) {
    console.error('ADMIN_ADDRESS and ADMIN_PASSWORD are required');
    process.exit(1);
  }

  const ds = dataSource;
  await ds.initialize();

  const passwordHash = await bcrypt.hash(password, 12);
  await ds.query(
    `INSERT INTO users (address, status, role, password_hash, nickname)
     VALUES ($1, 'active', 'admin', $2, '管理员')
     ON CONFLICT (address) DO UPDATE
       SET status = 'active',
           role = 'admin',
           password_hash = EXCLUDED.password_hash`,
    [address, passwordHash],
  );

  console.log(`Admin upserted: ${address}`);
  await ds.destroy();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
