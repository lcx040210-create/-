import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 用户对某一版条款的同意记录；唯一 (user_id, terms_version) 保证幂等。 */
@Entity('user_consents')
@Index('uq_user_consents_user_version', ['userId', 'termsVersion'], {
  unique: true,
})
export class UserConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'terms_version', type: 'int' })
  termsVersion: number;

  @CreateDateColumn({ name: 'agreed_at', type: 'timestamptz' })
  agreedAt: Date;
}
