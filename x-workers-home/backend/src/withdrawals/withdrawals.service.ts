import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThan, Repository } from 'typeorm';
import { BindingsService } from '../bindings/bindings.service';
import { MICRO, formatXm, parseXm, pctFloor } from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { User } from '../users/user.entity';
import { Withdrawal, WithdrawalStatus } from './withdrawal.entity';

/** 提现规则（spec §4）：≥ 50 XM、整十、每 24h 滚动窗口一笔。 */
export const WITHDRAWAL_MIN_MICRO = 50n * MICRO;
export const WITHDRAWAL_STEP_MICRO = 10n * MICRO;
export const WITHDRAWAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const WITHDRAWAL_FEE_NUM = 10;
export const WITHDRAWAL_FEE_DEN = 100;

/** 绑定钱包地址：BSC EVM 地址，小写（users.address 存储口径）。 */
const WALLET_PATTERN = /^0x[0-9a-f]{40}$/;

/** 处于冷却窗口内的状态；rejected 可立即重发。 */
const COOLDOWN_STATUSES: WithdrawalStatus[] = ['pending', 'approved', 'paid'];

export interface WithdrawalView {
  id: string;
  address: string;
  amountXm: string;
  feeXm: string;
  payoutXm: string;
  status: WithdrawalStatus;
  rejectReason: string | null;
  txHash: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  isFirst: boolean;
}

export interface WithdrawalRequestView {
  id: string;
  amountXm: string;
  feeXm: string;
  payoutXm: string;
  status: WithdrawalStatus;
}

@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectRepository(Withdrawal)
    private readonly withdrawals: Repository<Withdrawal>,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly bindings: BindingsService,
    private readonly referral: ReferralService,
  ) {}

  /**
   * 提现申请：校验规则 → 建 withdrawal 行（拿 id）→ 同一事务内冻结。
   * 地址只取 users.address（绑定钱包），不接受客户端传值。
   */
  async request(userId: string, amountXm: string): Promise<WithdrawalRequestView> {
    const amount = this.parseAmount(amountXm);
    if (amount < WITHDRAWAL_MIN_MICRO) {
      throw new BadRequestException('最低提现 50 XM');
    }
    if (amount % WITHDRAWAL_STEP_MICRO !== 0n) {
      throw new BadRequestException('提现金额必须是 10 XM 的整数倍');
    }

    const feeMicro = pctFloor(amount, WITHDRAWAL_FEE_NUM, WITHDRAWAL_FEE_DEN);
    const payoutMicro = amount - feeMicro;

    const row = await this.dataSource.transaction(async (tx) => {
      // 用户级串行锁（user 行 → account 行，与既有资金流锁序一致）：
      // 冷却/改绑都是 check-then-act，并发双击/脚本不得同时通过。
      const user = await tx.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new UnauthorizedException('用户不存在');
      }

      await this.assertCooldown(tx, userId);
      if (await this.bindings.hasPendingChange(userId, 'wallet', tx)) {
        throw new BadRequestException('存在未生效的钱包改绑申请，暂不可提现');
      }
      if (!WALLET_PATTERN.test(user.address ?? '')) {
        throw new BadRequestException('绑定钱包地址无效，请重新绑定钱包');
      }

      const repo = tx.getRepository(Withdrawal);
      // 先建行拿 id，冻结流水的 ref 用 withdrawal.id；任一步失败整体回滚。
      const created = await repo.save(
        repo.create({
          userId,
          address: user.address,
          amountMicro: amount,
          feeMicro,
          payoutMicro,
          status: 'pending',
          rejectReason: null,
          txHash: null,
          reviewedBy: null,
          reviewedAt: null,
        }),
      );
      await this.ledger.freezeAvailable(tx, {
        userId,
        amountMicro: amount,
        kind: 'withdrawal_hold',
        ref: { type: 'withdrawal', id: created.id },
      });
      return created;
    });

    return {
      id: row.id,
      amountXm: formatXm(row.amountMicro),
      feeXm: formatXm(row.feeMicro),
      payoutXm: formatXm(row.payoutMicro),
      status: row.status,
    };
  }

  /** 本人提现记录倒序；isFirst = 该用户尚无任何 paid 记录（首提标记）。 */
  async listMine(userId: string): Promise<WithdrawalView[]> {
    const [rows, paidCount] = await Promise.all([
      this.withdrawals.find({
        where: { userId },
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
      this.withdrawals.count({ where: { userId, status: 'paid' } }),
    ]);
    const isFirst = paidCount === 0;
    return rows.map((row) => this.toView(row, isFirst));
  }

  /** pending → approved（T17 admin 审核）。 */
  async approve(id: string, adminId: string): Promise<WithdrawalView> {
    const row = await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Withdrawal);
      const locked = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException('提现记录不存在');
      }
      if (locked.status !== 'pending') {
        throw new BadRequestException('只有待审核的提现可以审核通过');
      }
      locked.status = 'approved';
      locked.reviewedBy = adminId;
      locked.reviewedAt = new Date();
      return repo.save(locked);
    });
    return this.toView(row, await this.isFirst(row.userId));
  }

  /**
   * approved → paid：事务内锁行，冻结额整体出系统（consumeFrozen amount），
   * 记录 tx_hash。重复打款 / 未审核 → 400，且不产生二次出账。
   */
  async markPaid(
    id: string,
    txHash: string,
    adminId: string,
  ): Promise<WithdrawalView> {
    const row = await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Withdrawal);
      const locked = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException('提现记录不存在');
      }
      if (locked.status !== 'approved') {
        throw new BadRequestException('只有已审核通过的提现可以打款');
      }

      // 记账拆分：实付部分出系统；手续费先从冻结退回可用，再转入平台收入。
      // 手续费同事务先入 income，再做返佣（≤ 40%×fee）→ 结构上不可能余额不足。
      await this.ledger.consumeFrozen(tx, {
        userId: locked.userId,
        amountMicro: locked.payoutMicro,
        kind: 'withdrawal_paid',
        ref: { type: 'withdrawal', id: locked.id },
      });
      await this.ledger.unfreeze(tx, {
        userId: locked.userId,
        amountMicro: locked.feeMicro,
        kind: 'withdrawal_fee',
        ref: { type: 'withdrawal', id: locked.id },
      });
      await this.ledger.transfer(tx, {
        from: { userId: locked.userId },
        to: { platform: 'income' },
        amountMicro: locked.feeMicro,
        kind: 'withdrawal_fee',
        ref: { type: 'withdrawal', id: locked.id },
      });

      // 提现费是返佣基数：同一事务内给邀请人发返佣（无邀请人则 no-op）
      await this.referral.onFeeEvent(tx, {
        userId: locked.userId,
        feeMicro: locked.feeMicro,
        feeKind: 'withdrawal',
      });

      locked.status = 'paid';
      locked.txHash = txHash;
      locked.reviewedBy = adminId;
      locked.reviewedAt = new Date();
      return repo.save(locked);
    });
    return this.toView(row, await this.isFirst(row.userId));
  }

  /** pending|approved → rejected：事务内锁行，冻结退回可用。重复驳回 → 400。 */
  async reject(
    id: string,
    reason: string,
    adminId: string,
  ): Promise<WithdrawalView> {
    const row = await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Withdrawal);
      const locked = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException('提现记录不存在');
      }
      if (locked.status !== 'pending' && locked.status !== 'approved') {
        throw new BadRequestException('该提现已处理，不能驳回');
      }

      await this.ledger.unfreeze(tx, {
        userId: locked.userId,
        amountMicro: locked.amountMicro,
        kind: 'withdrawal_reject',
        ref: { type: 'withdrawal', id: locked.id },
      });

      locked.status = 'rejected';
      locked.rejectReason = reason;
      locked.reviewedBy = adminId;
      locked.reviewedAt = new Date();
      return repo.save(locked);
    });
    return this.toView(row, await this.isFirst(row.userId));
  }

  private parseAmount(amountXm: string): bigint {
    try {
      return parseXm(amountXm);
    } catch {
      throw new BadRequestException('非法提现金额');
    }
  }

  /** 24h 滚动窗口：本人存在 pending/approved/paid 且 created_at > now−24h 即拦截。 */
  private async assertCooldown(tx: EntityManager, userId: string): Promise<void> {
    const recent = await tx.getRepository(Withdrawal).count({
      where: {
        userId,
        status: In(COOLDOWN_STATUSES),
        createdAt: MoreThan(new Date(Date.now() - WITHDRAWAL_COOLDOWN_MS)),
      },
    });
    if (recent > 0) {
      throw new BadRequestException('24 小时内已有提现申请，请稍后再试');
    }
  }

  private async isFirst(userId: string): Promise<boolean> {
    return (await this.withdrawals.count({ where: { userId, status: 'paid' } })) === 0;
  }

  private toView(row: Withdrawal, isFirst: boolean): WithdrawalView {
    return {
      id: row.id,
      address: row.address,
      amountXm: formatXm(row.amountMicro),
      feeXm: formatXm(row.feeMicro),
      payoutXm: formatXm(row.payoutMicro),
      status: row.status,
      rejectReason: row.rejectReason,
      txHash: row.txHash,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      isFirst,
    };
  }
}
