import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { InsufficientFundsError, InvalidAmountError } from '../common/errors';
import { PLATFORM_ACCOUNTS } from '../database/migrations/1700000003000-ledger';
import { Account } from './account.entity';
import { LedgerEntry } from './ledger-entry.entity';

export type AccountRef = { userId: string } | { platform: 'escrow' | 'income' };

export type LedgerKind =
  | 'deposit_credit'
  | 'order_freeze'
  | 'order_refund'
  | 'posting_fee'
  | 'slot_payout'
  | 'completion_fee'
  | 'withdrawal_hold'
  | 'withdrawal_reject'
  | 'withdrawal_paid'
  | 'withdrawal_fee'
  | 'referral_rebate'
  | 'forfeit'
  | 'deletion_clawback';

export type LedgerRef = {
  type: 'order' | 'slot' | 'withdrawal' | 'deposit' | 'user';
  id: string;
};

/**
 * 全项目资金唯一入口。所有方法都必须在调用方事务内执行：
 * 锁使用 pessimistic_write（SELECT ... FOR UPDATE），涉及两个账户时按 account.id
 * 升序依次加锁，避免死锁；余额判断一律在锁内重新读取后进行。
 *
 * 不变量：
 * - credit：Σ(available + frozen) +amount
 * - consumeFrozen：Σ(available + frozen) −amount
 * - transfer / freezeAvailable / unfreeze / forfeitAll：Σ(available + frozen) 不变
 * - 任何账户任何时刻不得为负
 */
@Injectable()
export class LedgerService {
  /** 取得（必要时创建）账户；平台账户由迁移预置。 */
  async getOrCreateAccount(tx: EntityManager, ref: AccountRef): Promise<Account> {
    if ('platform' in ref) {
      return this.getPlatformAccount(tx, ref.platform);
    }

    const repo = tx.getRepository(Account);
    const existing = await repo.findOne({ where: { ownerUserId: ref.userId } });
    if (existing) return existing;

    // 并发安全：同一用户只允许一个账户；冲突时由唯一约束兜底。
    await tx.query(
      `INSERT INTO "accounts" ("owner_user_id", "kind") VALUES ($1, 'user')
       ON CONFLICT ("owner_user_id") DO NOTHING`,
      [ref.userId],
    );
    return repo.findOneOrFail({ where: { ownerUserId: ref.userId } });
  }

  /** 两账户间转账；写两行流水（转出方 / 转入方），总额不变。 */
  async transfer(
    tx: EntityManager,
    p: {
      from: AccountRef;
      to: AccountRef;
      amountMicro: bigint;
      kind: LedgerKind;
      ref: LedgerRef;
      memo?: string;
    },
  ): Promise<void> {
    this.assertPositive(p.amountMicro);

    // 无锁预读：转出账户不存在或余额明显不足时直接失败，不产生任何写入
    // （尤其不得为收款方凭空创建账户）。锁内仍会重读余额并以锁内结果为准。
    const fromExisting = await this.findAccount(tx, p.from);
    if (!fromExisting) {
      throw new InsufficientFundsError(0n, p.amountMicro);
    }
    if (fromExisting.available < p.amountMicro) {
      throw new InsufficientFundsError(fromExisting.available, p.amountMicro);
    }
    const toExisting = await this.getOrCreateAccount(tx, p.to);
    if (fromExisting.id === toExisting.id) {
      throw new BadRequestException('转出与转入账户不能相同');
    }

    // 按 account.id 排序依次加锁（防死锁），锁内重读余额。
    const locked = await this.lockAccounts(tx, [fromExisting.id, toExisting.id]);
    const from = locked.get(fromExisting.id)!;
    const to = locked.get(toExisting.id)!;

    if (from.available < p.amountMicro) {
      throw new InsufficientFundsError(from.available, p.amountMicro);
    }

    from.available -= p.amountMicro;
    to.available += p.amountMicro;
    await tx.getRepository(Account).save([from, to]);
    await tx.insert(LedgerEntry, [
      this.buildEntry(from, -p.amountMicro, 0n, p.kind, p.ref, p.memo),
      this.buildEntry(to, p.amountMicro, 0n, p.kind, p.ref, p.memo),
    ]);
  }

  /** 用户可用 → 用户冻结（提现申请）。 */
  async freezeAvailable(
    tx: EntityManager,
    p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef },
  ): Promise<void> {
    this.assertPositive(p.amountMicro);
    const account = await this.findAccount(tx, { userId: p.userId });
    if (!account) {
      throw new InsufficientFundsError(0n, p.amountMicro);
    }

    const locked = await this.lockAccount(tx, account.id);
    if (locked.available < p.amountMicro) {
      throw new InsufficientFundsError(locked.available, p.amountMicro);
    }

    locked.available -= p.amountMicro;
    locked.frozen += p.amountMicro;
    await tx.getRepository(Account).save(locked);
    await tx.insert(LedgerEntry, [
      this.buildEntry(locked, -p.amountMicro, p.amountMicro, p.kind, p.ref),
    ]);
  }

  /** 用户冻结 → 用户可用（提现驳回）。 */
  async unfreeze(
    tx: EntityManager,
    p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef },
  ): Promise<void> {
    this.assertPositive(p.amountMicro);
    const account = await this.findAccount(tx, { userId: p.userId });
    if (!account) {
      throw new InsufficientFundsError(0n, p.amountMicro);
    }

    const locked = await this.lockAccount(tx, account.id);
    if (locked.frozen < p.amountMicro) {
      throw new InsufficientFundsError(locked.frozen, p.amountMicro);
    }

    locked.frozen -= p.amountMicro;
    locked.available += p.amountMicro;
    await tx.getRepository(Account).save(locked);
    await tx.insert(LedgerEntry, [
      this.buildEntry(locked, p.amountMicro, -p.amountMicro, p.kind, p.ref),
    ]);
  }

  /** 用户冻结 → 出系统（打款完成）；系统总额相应减少。 */
  async consumeFrozen(
    tx: EntityManager,
    p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef },
  ): Promise<void> {
    this.assertPositive(p.amountMicro);
    const account = await this.findAccount(tx, { userId: p.userId });
    if (!account) {
      throw new InsufficientFundsError(0n, p.amountMicro);
    }

    const locked = await this.lockAccount(tx, account.id);
    if (locked.frozen < p.amountMicro) {
      throw new InsufficientFundsError(locked.frozen, p.amountMicro);
    }

    locked.frozen -= p.amountMicro;
    await tx.getRepository(Account).save(locked);
    await tx.insert(LedgerEntry, [
      this.buildEntry(locked, 0n, -p.amountMicro, p.kind, p.ref),
    ]);
  }

  /** 系统外 → 用户可用（充值入账）；系统总额相应增加。 */
  async credit(
    tx: EntityManager,
    p: { userId: string; amountMicro: bigint; kind: LedgerKind; ref: LedgerRef },
  ): Promise<void> {
    this.assertPositive(p.amountMicro);

    const account = await this.getOrCreateAccount(tx, { userId: p.userId });
    const locked = await this.lockAccount(tx, account.id);
    locked.available += p.amountMicro;
    await tx.getRepository(Account).save(locked);
    await tx.insert(LedgerEntry, [
      this.buildEntry(locked, p.amountMicro, 0n, p.kind, p.ref),
    ]);
  }

  /**
   * 没收：用户可用 + 冻结全部 → platform_income，返回没收总额。
   * 已为 0 时返回 0 且不写流水。
   */
  async forfeitAll(
    tx: EntityManager,
    p: { userId: string; ref: LedgerRef },
  ): Promise<bigint> {
    const userAccount = await this.findAccount(tx, { userId: p.userId });
    if (!userAccount) return 0n;

    const incomeAccount = await this.getPlatformAccount(tx, 'income');
    const locked = await this.lockAccounts(tx, [userAccount.id, incomeAccount.id]);
    const user = locked.get(userAccount.id)!;
    const income = locked.get(incomeAccount.id)!;

    const available = user.available;
    const frozen = user.frozen;
    const total = available + frozen;
    if (total === 0n) return 0n;

    user.available = 0n;
    user.frozen = 0n;
    income.available += total;
    await tx.getRepository(Account).save([user, income]);
    await tx.insert(LedgerEntry, [
      this.buildEntry(user, -available, -frozen, 'forfeit', p.ref),
      this.buildEntry(income, total, 0n, 'forfeit', p.ref),
    ]);
    return total;
  }

  private assertPositive(amountMicro: bigint): void {
    if (typeof amountMicro !== 'bigint' || amountMicro <= 0n) {
      throw new InvalidAmountError();
    }
  }

  private async findAccount(
    tx: EntityManager,
    ref: AccountRef,
  ): Promise<Account | null> {
    if ('platform' in ref) {
      return this.getPlatformAccount(tx, ref.platform);
    }
    return tx.getRepository(Account).findOne({ where: { ownerUserId: ref.userId } });
  }

  private async getPlatformAccount(
    tx: EntityManager,
    platform: 'escrow' | 'income',
  ): Promise<Account> {
    const account = await tx
      .getRepository(Account)
      .findOne({ where: { id: PLATFORM_ACCOUNTS[platform] } });
    if (!account) {
      throw new Error(`平台账户未初始化：${platform}`);
    }
    return account;
  }

  /** 按 account.id 升序依次 SELECT ... FOR UPDATE，返回 id → 锁定后的账户。 */
  private async lockAccounts(
    tx: EntityManager,
    accountIds: string[],
  ): Promise<Map<string, Account>> {
    const ids = Array.from(new Set(accountIds)).sort();
    const locked = new Map<string, Account>();

    for (const id of ids) {
      const account = await tx.getRepository(Account).findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new Error(`账户不存在：${id}`);
      }
      locked.set(id, account);
    }
    return locked;
  }

  private async lockAccount(tx: EntityManager, accountId: string): Promise<Account> {
    const locked = await this.lockAccounts(tx, [accountId]);
    return locked.get(accountId)!;
  }

  private buildEntry(
    account: Account,
    availableDelta: bigint,
    frozenDelta: bigint,
    kind: LedgerKind,
    ref: LedgerRef,
    memo?: string,
  ): Partial<LedgerEntry> {
    return {
      accountId: account.id,
      userId: account.ownerUserId,
      kind,
      refType: ref.type,
      refId: ref.id,
      availableDelta,
      frozenDelta,
      availableAfter: account.available,
      frozenAfter: account.frozen,
      memo: memo ?? null,
    };
  }
}
