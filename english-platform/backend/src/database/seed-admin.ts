import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import config from '../config/database.config';

async function seed() {
  const ds = new DataSource(config);
  await ds.initialize();

  const existing = await ds.query(`SELECT id FROM users WHERE email = 'admin@platform.com'`);
  if (existing.length > 0) {
    console.log('Admin user already exists.');
    await ds.destroy();
    return;
  }

  const hash = await bcrypt.hash('admin123456', 12);
  await ds.query(
    `INSERT INTO users (email, password_hash, role, name, status) VALUES ($1, $2, $3, $4, $5)`,
    ['admin@platform.com', hash, 'admin', '管理员', 'active'],
  );
  console.log('Admin user created: admin@platform.com / admin123456');
  await ds.destroy();
}

seed();
