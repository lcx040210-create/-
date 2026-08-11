import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum PackageStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

@Entity('packages')
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column('int')
  lesson_count: number;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column('int')
  valid_days: number;

  @Column('jsonb', { default: '[]' })
  exam_types: string[];

  @Column('jsonb', { default: '[]' })
  skills: string[];

  @Column('text', { nullable: true })
  description: string;

  @Column({ type: 'enum', enum: PackageStatus, default: PackageStatus.DRAFT })
  status: PackageStatus;

  @CreateDateColumn()
  created_at: Date;
}
