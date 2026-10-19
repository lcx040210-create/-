import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 小写 BSC 地址 = 登录身份
  @Column({ type: 'varchar', length: 42, unique: true })
  address: string;

  // pending_x_binding | active | suspended
  @Column({ type: 'varchar', length: 24, default: 'pending_x_binding' })
  status: string;

  // user | admin
  @Column({ type: 'varchar', length: 16, default: 'user' })
  role: string;

  // 仅 admin 使用
  @Column({ name: 'password_hash', type: 'varchar', length: 72, nullable: true })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname: string | null;

  // 冗余展示列，T6 维护
  @Column({ name: 'rating_grade', type: 'varchar', length: 2, nullable: true })
  ratingGrade: string | null;

  @Column({ type: 'int', default: 0 })
  violations: number;

  @Column({ name: 'suspended_until', type: 'timestamptz', nullable: true })
  suspendedUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
