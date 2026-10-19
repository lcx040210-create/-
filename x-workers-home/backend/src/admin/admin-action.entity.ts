import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 管理后台审计日志：本任务所有 admin 写操作落一行。 */
@Entity('admin_actions')
@Index('idx_admin_actions_admin_created', ['adminUserId', 'createdAt'])
@Index('idx_admin_actions_target', ['targetType', 'targetId', 'createdAt'])
export class AdminAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 操作管理员（users.id）；管理员被删除后置 null，保留审计。 */
  @Column({ name: 'admin_user_id', type: 'uuid', nullable: true })
  adminUserId: string | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', length: 32 })
  targetType: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64 })
  targetId: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  detail: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
