import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 版本化服务条款；全表仅一条 is_current=true（迁移内部分唯一索引约束）。 */
@Entity('terms')
export class Term {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  version: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ name: 'content_md', type: 'text' })
  contentMd: string;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt: Date;

  @Column({ name: 'is_current', type: 'boolean', default: false })
  isCurrent: boolean;
}
