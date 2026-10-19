import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 双向互评（T16）：一个 paid 名额上，商家与接单方各可评价对方一次。
 * 「每侧一次」由唯一索引 (slot_id, from_user_id) 兜底。
 */
@Entity('reviews')
@Index('uq_reviews_slot_from', ['slotId', 'fromUserId'], { unique: true })
@Index('idx_reviews_to_user', ['toUserId'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'slot_id', type: 'uuid' })
  slotId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'from_user_id', type: 'uuid' })
  fromUserId: string;

  @Column({ name: 'to_user_id', type: 'uuid' })
  toUserId: string;

  /** 1..5 星（迁移里另有 CHECK 约束）。 */
  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
