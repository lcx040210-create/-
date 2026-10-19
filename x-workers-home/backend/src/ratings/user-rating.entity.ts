import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 每用户一行；user_id 既是主键也保证唯一 */
@Entity('user_ratings')
export class UserRating {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'varchar', length: 2 })
  grade: string;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  flags: string[];

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  breakdown: Record<string, number>;

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;
}
