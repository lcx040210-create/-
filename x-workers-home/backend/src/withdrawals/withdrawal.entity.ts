import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigintTransformer } from '../ledger/bigint.transformer';

export type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected';

/**
 * 一笔提现申请。申请时按绑定钱包地址建单并立即冻结 amount_micro；
 * 人工审核通过后打款（consumeFrozen）或驳回（unfreeze）。
 * fee = floor(amount × 10%)，payout = amount − fee。
 */
@Entity('withdrawals')
@Index('idx_withdrawals_user_created', ['userId', 'createdAt'])
@Index('idx_withdrawals_status', ['status'])
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 申请时的绑定钱包地址（users.address，小写） */
  @Column({ type: 'varchar', length: 42 })
  address: string;

  @Column({ name: 'amount_micro', type: 'bigint', transformer: bigintTransformer })
  amountMicro: bigint;

  @Column({ name: 'fee_micro', type: 'bigint', transformer: bigintTransformer })
  feeMicro: bigint;

  @Column({ name: 'payout_micro', type: 'bigint', transformer: bigintTransformer })
  payoutMicro: bigint;

  @Column({ type: 'varchar', length: 16 })
  status: WithdrawalStatus;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason: string | null;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
  txHash: string | null;

  /** 审核人（admin users.id；T17 记录审计） */
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
