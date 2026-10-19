import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 邀请关系：invitee 只能被绑定一次（UNIQUE），绑定在建号事务内完成。
 * 档位按 referrer 名下 invitee 状态为 active 的人数计算。
 */
@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'referrer_user_id', type: 'uuid' })
  referrerUserId: string;

  @Column({ name: 'invitee_user_id', type: 'uuid', unique: true })
  inviteeUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
