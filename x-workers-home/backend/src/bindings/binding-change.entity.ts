import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type BindingChangeKind = 'wallet' | 'x';
export type BindingChangeStatus = 'pending' | 'approved' | 'rejected';

@Entity('binding_changes')
@Index('idx_binding_changes_user_kind', ['userId', 'kind', 'status'])
@Index('idx_binding_changes_due', ['status', 'effectiveAt'])
export class BindingChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 8 })
  kind: BindingChangeKind;

  // wallet: 新地址（小写）；x: 新 handle（小写）
  @Column({ name: 'new_value', type: 'varchar', length: 64 })
  newValue: string;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: BindingChangeStatus;

  @Column({ name: 'effective_at', type: 'timestamptz' })
  effectiveAt: Date;

  // 冷静期到 + admin 审核通过后由轮询器落库；落库后置为 now()
  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
