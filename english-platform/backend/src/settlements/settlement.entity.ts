import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum SettlementStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  PAID = 'paid',
}

@Entity('settlements')
export class Settlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  teacher_id: string;

  @Column('date')
  period_start: string;

  @Column('date')
  period_end: string;

  @Column('int')
  total_lessons: number;

  @Column('decimal', { precision: 10, scale: 2 })
  base_amount: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  bonus_volume: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  bonus_rating: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  bonus_renewal: number;

  @Column('decimal', { precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'enum', enum: SettlementStatus, default: SettlementStatus.DRAFT })
  status: SettlementStatus;

  @CreateDateColumn()
  created_at: Date;
}
