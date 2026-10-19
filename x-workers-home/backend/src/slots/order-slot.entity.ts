import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type OrderSlotStatus =
  | 'reserved'
  | 'verifying'
  | 'passed'
  | 'disputed'
  | 'paid'
  | 'refunded'
  | 'expired';

/** 仍在消耗托管（P 未离开 escrow）的名额状态。 */
export const ESCROW_HELD_SLOT_STATUSES: readonly OrderSlotStatus[] = [
  'reserved',
  'verifying',
  'passed',
  'disputed',
];

/**
 * 名额。金额不落在名额上：托管始终记在订单 escrow_micro。
 * 活跃名额（非 expired/refunded）唯一约束由迁移里的部分唯一索引保证：
 * 一个用户在一张商单里只能占一个名额。
 */
@Entity('order_slots')
@Index('idx_order_slots_order_status', ['orderId', 'status'])
@Index('idx_order_slots_creator_status', ['creatorUserId', 'status'])
export class OrderSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'creator_user_id', type: 'uuid' })
  creatorUserId: string;

  @Column({ type: 'varchar', length: 16, default: 'reserved' })
  status: OrderSlotStatus;

  @Column({ name: 'accepted_at', type: 'timestamptz' })
  acceptedAt: Date;

  /** 接单时间 + 3h（T12），过期后名额回自由池。 */
  @Column({ name: 'deliver_deadline_at', type: 'timestamptz' })
  deliverDeadlineAt: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'delivery_url', type: 'text', nullable: true })
  deliveryUrl: string | null;

  /**
   * 从 delivery_url 提取的推文状态 id（T13 fix）。
   * 部分唯一索引按 id 去重，拦截同一推文的 handle / i-web 两种 URL 形式。
   */
  @Column({ name: 'delivery_tweet_id', type: 'varchar', length: 32, nullable: true })
  deliveryTweetId: string | null;

  /** 最近一次核验驳回（T13 写入）：{ reasons, snapshot, at }。 */
  @Column({ name: 'last_reject', type: 'jsonb', nullable: true })
  lastReject: Record<string, any> | null;

  @Column({ name: 'verify_snapshot', type: 'jsonb', nullable: true })
  verifySnapshot: Record<string, any> | null;

  @Column({ name: 'manual_reasons', type: 'jsonb', default: () => "'[]'::jsonb" })
  manualReasons: string[];

  @Column({ name: 'appeal_requested', type: 'boolean', default: false })
  appealRequested: boolean;

  @Column({ name: 'confirmed_deadline_at', type: 'timestamptz', nullable: true })
  confirmedDeadlineAt: Date | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  /**
   * 人工裁决放行（T15 争议 payout / T13 人工核验 pass）：
   * payout job 跳过存活复检，防止「人工放行被已删推文弹回」。
   */
  @Column({ name: 'survival_override', type: 'boolean', default: false })
  survivalOverride: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
