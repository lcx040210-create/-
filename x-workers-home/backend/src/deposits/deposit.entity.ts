import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../ledger/bigint.transformer';

export type DepositStatus = 'credited' | 'unmatched';

/**
 * 一笔链上 USDT 转入（按 tx_hash + log_index 唯一）。
 * credited：已按 from 地址匹配到用户并 1:1 入账；unmatched：待人工认领。
 */
@Entity('deposits')
export class Deposit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66 })
  txHash: string;

  @Column({ name: 'log_index', type: 'int' })
  logIndex: number;

  @Column({ name: 'from_address', type: 'varchar', length: 42 })
  fromAddress: string;

  @Column({ name: 'to_address', type: 'varchar', length: 42 })
  toAddress: string;

  /** 链上原始金额（18 位小数 wei 十进制字符串，原样留档） */
  @Column({ name: 'raw_amount_wei', type: 'varchar', length: 78 })
  rawAmountWei: string;

  /** fromWei18(raw_amount_wei)，向下取整到 micro-XM */
  @Column({ name: 'amount_micro', type: 'bigint', transformer: bigintTransformer })
  amountMicro: bigint;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: DepositStatus;

  @Column({ name: 'block_number', type: 'bigint', transformer: bigintTransformer })
  blockNumber: bigint;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
