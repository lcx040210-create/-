import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from './bigint.transformer';

/**
 * 资金流水：每次资金动作按受影响账户各写一行。
 * transfer / forfeitAll 涉及两个账户 → 两行；单账户原语（freeze/unfreeze/consume/credit）→ 一行。
 * available_after / frozen_after 记录该行写入后的账户余额快照。
 */
@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @Column({ name: 'ref_type', type: 'varchar', length: 16 })
  refType: string;

  @Column({ name: 'ref_id', type: 'uuid' })
  refId: string;

  @Column({ name: 'available_delta', type: 'bigint', transformer: bigintTransformer })
  availableDelta: bigint;

  @Column({ name: 'frozen_delta', type: 'bigint', transformer: bigintTransformer })
  frozenDelta: bigint;

  @Column({ name: 'available_after', type: 'bigint', transformer: bigintTransformer })
  availableAfter: bigint;

  @Column({ name: 'frozen_after', type: 'bigint', transformer: bigintTransformer })
  frozenAfter: bigint;

  @Column({ type: 'text', nullable: true })
  memo: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
