import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from './bigint.transformer';

/**
 * 资金账户：每个用户一个（owner_user_id 唯一），外加两个平台账户
 * （escrow / platform_income，owner_user_id 为 null，由迁移预置）。
 * 所有余额均为 micro-XM 的 bigint。
 */
@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true, unique: true })
  ownerUserId: string | null;

  // user | escrow | platform_income
  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  available: bigint;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  frozen: bigint;
}
