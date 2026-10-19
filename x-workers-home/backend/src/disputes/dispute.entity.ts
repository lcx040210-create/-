import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DisputeRaisedBy = 'merchant' | 'creator';
export type DisputeKind = 'quality' | 'deletion';
export type DisputeStatus =
  | 'open'
  | 'resolved_payout'
  | 'resolved_refund'
  | 'resolved_clawback';
export type DisputeRuling = 'payout' | 'refund' | 'clawback';

/** 回应记录：随 respond 追加到 evidence。 */
export interface DisputeEvidenceEntry {
  /** 回应人 user id。 */
  by: string;
  /** 回应人在本争议中的角色。 */
  role: DisputeRaisedBy;
  statement: string;
  /** ISO 时间串。 */
  at: string;
}

/**
 * 争议（T15）。quality = 确认窗内的质量申诉；deletion = 放款后 7 天内的删帖举报。
 * 同一 slot 同一时刻至多一个 open 争议（迁移里的部分唯一索引保证）。
 */
@Entity('disputes')
@Index('idx_disputes_slot', ['slotId'])
@Index('idx_disputes_status', ['status'])
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'slot_id', type: 'uuid' })
  slotId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'raised_by', type: 'varchar', length: 16 })
  raisedBy: DisputeRaisedBy;

  @Column({ type: 'varchar', length: 16 })
  kind: DisputeKind;

  @Column({ type: 'text' })
  statement: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidence: DisputeEvidenceEntry[];

  @Column({ type: 'varchar', length: 24, default: 'open' })
  status: DisputeStatus;

  /** 裁决文案（含人工备注；删帖部分追回时记录差额）。 */
  @Column({ type: 'text', nullable: true })
  ruling: string | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /** 预留：仲裁者信息 / 结构化追回数据（recoveredMicro / shortfallMicro / note）。 */
  @Column({ name: 'arbiter_meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  arbiterMeta: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
