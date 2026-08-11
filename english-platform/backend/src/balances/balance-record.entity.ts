import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('balance_records')
export class BalanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  student_id: string;

  @Column()
  order_id: string;

  @Column('jsonb', { default: '[]' })
  exam_types: string[];

  @Column('jsonb', { default: '[]' })
  skills: string[];

  @Column('int')
  total_lessons: number;

  @Column('int')
  remaining: number;

  @Column('date')
  expires_at: string;

  @CreateDateColumn()
  created_at: Date;
}
