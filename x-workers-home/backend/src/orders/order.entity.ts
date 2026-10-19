import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigintTransformer } from '../ledger/bigint.transformer';

export type OrderType = 'post' | 'comment' | 'quote';
export type OrderStatus = 'recruiting' | 'closed' | 'completed';

/** 交付要求：逐项包含即通过（T13 核验口径）。 */
export interface OrderRequirements {
  keywords: string[];
  hashtags: string[];
  mentions: string[];
  links: string[];
  /** 最少字符数；缺省按类型默认（T13）。 */
  minChars?: number;
}

/**
 * 商单。金额均为 micro-XM bigint。
 * 托管不变量：escrow_micro = P × (slots_total − 已终态名额数) + (fee_earned ? 0 : fee_micro)。
 * 名额表在 T12 引入；T11 创建时全部名额均为自由池。
 */
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'merchant_user_id', type: 'uuid' })
  merchantUserId: string;

  @Column({ type: 'varchar', length: 16 })
  type: OrderType;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text' })
  brief: string;

  @Column({ type: 'jsonb' })
  requirements: OrderRequirements;

  @Column({ name: 'target_tweet_url', type: 'text', nullable: true })
  targetTweetUrl: string | null;

  @Column({ name: 'price_micro', type: 'bigint', transformer: bigintTransformer })
  priceMicro: bigint;

  @Column({ name: 'slots_total', type: 'int' })
  slotsTotal: number;

  /** 发单费 = pctFloor(P×N, 5, 100)；随托管一起冻结，首次被抢单才转 income（T12）。 */
  @Column({ name: 'fee_micro', type: 'bigint', transformer: bigintTransformer })
  feeMicro: bigint;

  @Column({ name: 'fee_earned', type: 'boolean', default: false })
  feeEarned: boolean;

  @Column({ name: 'escrow_micro', type: 'bigint', transformer: bigintTransformer })
  escrowMicro: bigint;

  @Column({ type: 'varchar', length: 16, default: 'recruiting' })
  status: OrderStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** 预留：最低评级要求，1.0 不启用。 */
  @Column({ name: 'min_rating_grade', type: 'varchar', length: 2, nullable: true })
  minRatingGrade: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
