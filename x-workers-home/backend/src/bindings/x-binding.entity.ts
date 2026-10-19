import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type XBindingStatus = 'pending' | 'active' | 'manual';
export type XBindingApiStatus = 'none' | 'pending' | 'active' | 'manual_review';

/** API 对外状态映射：DB 的 manual 展示为 manual_review */
export function toApiBindingStatus(status?: string | null): XBindingApiStatus {
  if (status === 'active' || status === 'pending') return status;
  if (status === 'manual') return 'manual_review';
  return 'none';
}

@Entity('x_bindings')
export class XBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  // 统一小写存储，去重语义由唯一约束保证
  @Column({ type: 'varchar', length: 16, unique: true })
  handle: string;

  // 初始绑定验证码 XWH-XXXXXX；改绑验证码只存在于 job payload
  @Column({ type: 'varchar', length: 16 })
  code: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: XBindingStatus;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
