import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { formatXm } from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import { User } from '../users/user.entity';
import { Deposit } from './deposit.entity';

export interface DepositView {
  id: string;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  userId: string | null;
  /** 十进制字符串，1:1 XM */
  amount: string;
  /** micro-XM 十进制字符串（前端精确计算用） */
  amountMicro: string;
  status: string;
  blockNumber: number;
  createdAt: Date;
}

@Injectable()
export class DepositsService {
  constructor(
    @InjectRepository(Deposit)
    private readonly deposits: Repository<Deposit>,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /** 本人充值记录，按块高倒序（同块按 logIndex 倒序）。 */
  async listMine(userId: string): Promise<DepositView[]> {
    const rows = await this.deposits.find({
      where: { userId },
      order: { blockNumber: 'DESC', logIndex: 'DESC' },
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * 人工认领：把 unmatched 的充值挂到指定用户并 1:1 入账（T17 admin 调用）。
   * 事务内锁定 deposit 行，重复认领 / 已入账记录直接拒绝，避免重复入账。
   */
  async claimTo(depositId: string, userId: string): Promise<DepositView> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Deposit);
      const deposit = await repo.findOne({
        where: { id: depositId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!deposit) {
        throw new NotFoundException('充值记录不存在');
      }
      if (deposit.status !== 'unmatched' || deposit.userId !== null) {
        throw new BadRequestException('该充值记录已入账或已被认领');
      }

      const user = await tx.getRepository(User).findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('用户不存在');
      }

      await this.ledger.credit(tx, {
        userId,
        amountMicro: deposit.amountMicro,
        kind: 'deposit_credit',
        ref: { type: 'deposit', id: deposit.id },
      });

      deposit.userId = userId;
      deposit.status = 'credited';
      await repo.save(deposit);
      return this.toView(deposit);
    });
  }

  private toView(deposit: Deposit): DepositView {
    return {
      id: deposit.id,
      txHash: deposit.txHash,
      logIndex: deposit.logIndex,
      fromAddress: deposit.fromAddress,
      userId: deposit.userId,
      amount: formatXm(deposit.amountMicro),
      amountMicro: deposit.amountMicro.toString(),
      status: deposit.status,
      blockNumber: Number(deposit.blockNumber),
      createdAt: deposit.createdAt,
    };
  }
}
