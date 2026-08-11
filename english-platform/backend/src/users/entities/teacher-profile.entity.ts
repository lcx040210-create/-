import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('teacher_profiles')
export class TeacherProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, (user) => user.teacherProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  user_id: string;

  @Column()
  display_name: string;

  @Column({ type: 'text', nullable: true })
  intro: string;

  @Column({ type: 'jsonb', default: '[]' })
  exam_types: string[];

  @Column({ type: 'jsonb', default: '[]' })
  skills: string[];

  @Column({ nullable: true })
  avatar_url: string;

  @Column({ type: 'jsonb', default: '[]' })
  tags: string[];

  @Column({ type: 'enum', enum: ReviewStatus, default: ReviewStatus.PENDING })
  review_status: ReviewStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  base_rate: number;

  @Column({ type: 'int', nullable: true })
  max_daily_lessons: number;
}
