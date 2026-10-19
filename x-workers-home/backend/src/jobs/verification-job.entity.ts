import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type VerificationJobStatus = 'pending' | 'done' | 'failed' | 'manual';

@Entity('verification_jobs')
export class VerificationJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 'x_binding' | 'delivery' | ...
  @Column({ type: 'varchar', length: 32 })
  type: string;

  // 通用引用 id（x_binding 用 userId；delivery 用 slotId 等）
  @Column({ name: 'ref_id', type: 'varchar', length: 64 })
  refId: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, any>;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: VerificationJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'next_run_at', type: 'timestamptz', default: () => 'now()' })
  nextRunAt: Date;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
