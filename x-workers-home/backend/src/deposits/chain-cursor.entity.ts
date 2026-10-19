import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from '../ledger/bigint.transformer';

/** 链监听游标：记录已处理到的块高（当前只有 id='bsc'）。 */
@Entity('chain_cursors')
export class ChainCursor {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  id: string;

  @Column({ name: 'last_block', type: 'bigint', transformer: bigintTransformer })
  lastBlock: bigint;
}
