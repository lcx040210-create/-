import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { formatXm } from '../common/money';
import { Account } from '../ledger/account.entity';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/order.entity';
import { SettlementService } from '../settlement/settlement.service';
import {
  ESCROW_HELD_SLOT_STATUSES,
  OrderSlot,
} from '../slots/order-slot.entity';
import { User } from '../users/user.entity';
import {
  Dispute,
  DisputeEvidenceEntry,
  DisputeKind,
  DisputeRuling,
  DisputeStatus,
} from './dispute.entity';

/** 放款后删帖举报窗口：7 天。 */
export const DELETION_REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const NOTIFY_DISPUTE_OPENED = 'dispute_opened';
export const NOTIFY_DISPUTE_RESOLVED = 'dispute_resolved';

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; driverError?: { code?: string } } | null;
  return candidate?.code === '23505' || candidate?.driverError?.code === '23505';
}

/**
 * 争议（T15）：
 * - 商家在 48h 确认窗内发起质量争议 → 名额 disputed（自动放款只拾取 passed，自然被挡）
 *   并撤销未执行的 payout job；
 * - 放款后 7 天内可举报删帖 → 建 deletion 争议（不改名额状态）；
 * - 双方可追加 evidence；
 * - 人工裁决（HTTP 在 T17）：payout / refund / clawback。
 *
 * 锁序与 T14 一致：争议行 → 订单行 → 名额行 → ledger 账户（账户按 id 升序）。
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly settlement: SettlementService,
  ) {}

  /**
   * 商家发起质量争议：仅本单商家、仅 passed 且确认窗内。
   * 事务内：名额 disputed + 撤销 pending payout + 建 open 争议 + 通知双方。
   */
  async raiseQualityDispute(
    slotId: string,
    merchantId: string,
    statement: string,
  ): Promise<Dispute> {
    try {
      return await this.dataSource.transaction(async (tx) => {
        const { order, slot } = await this.lockOrderAndSlot(tx, slotId);
        if (order.merchantUserId !== merchantId) {
          throw new ForbiddenException('只能对自己的商单发起争议');
        }
        await this.assertNoOpenDispute(tx, slot.id);
        if (slot.status !== 'passed') {
          throw new BadRequestException('当前名额状态不可发起争议');
        }
        const now = new Date();
        if (
          !slot.confirmedDeadlineAt ||
          now.getTime() >= slot.confirmedDeadlineAt.getTime()
        ) {
          throw new BadRequestException('已超过 48 小时确认窗，不可发起争议');
        }

        const dispute = await this.createOpenDispute(tx, {
          slot,
          order,
          kind: 'quality',
          statement,
        });

        slot.status = 'disputed';
        await tx.getRepository(OrderSlot).save(slot);

        // 撤销本 slot 尚未执行的自动放款任务（已 paid/其他状态时 delete 无副作用）。
        await this.settlement.cancelPayoutJob(slot.id);

        await this.notifyOpened(tx, order, slot, 'quality');
        return dispute;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('该名额已有进行中的争议');
      }
      throw err;
    }
  }

  /**
   * 商家举报删帖：仅本单商家、仅 paid 且 settled_at 在 7 天内。
   * 不改名额状态，只建 open 争议等待人工追回。
   */
  async reportDeletion(
    slotId: string,
    merchantId: string,
    statement: string,
  ): Promise<Dispute> {
    try {
      return await this.dataSource.transaction(async (tx) => {
        const { order, slot } = await this.lockOrderAndSlot(tx, slotId);
        if (order.merchantUserId !== merchantId) {
          throw new ForbiddenException('只能对自己的商单举报删帖');
        }
        await this.assertNoOpenDispute(tx, slot.id);
        if (slot.status !== 'paid' || !slot.settledAt) {
          throw new BadRequestException('只有已放款的名额可以举报删帖');
        }
        if (Date.now() - slot.settledAt.getTime() > DELETION_REPORT_WINDOW_MS) {
          throw new BadRequestException('已超过 7 天删帖举报窗口');
        }

        const dispute = await this.createOpenDispute(tx, {
          slot,
          order,
          kind: 'deletion',
          statement,
        });
        await this.notifyOpened(tx, order, slot, 'deletion');
        return dispute;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('该名额已有进行中的争议');
      }
      throw err;
    }
  }

  /** 当事人（商家或接单方）回应争议：追加 evidence；非当事人 403、已结案 400。 */
  async respond(disputeId: string, userId: string, statement: string): Promise<Dispute> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Dispute);
      const dispute = await repo.findOne({
        where: { id: disputeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispute) {
        throw new NotFoundException('争议不存在');
      }

      const order = await tx.getRepository(Order).findOne({
        where: { id: dispute.orderId },
      });
      const slot = await tx.getRepository(OrderSlot).findOne({
        where: { id: dispute.slotId },
      });
      if (!order || !slot) {
        throw new NotFoundException('争议关联资源不存在');
      }

      const isMerchant = order.merchantUserId === userId;
      const isCreator = slot.creatorUserId === userId;
      if (!isMerchant && !isCreator) {
        throw new ForbiddenException('只有争议当事人可以回应');
      }
      if (dispute.status !== 'open') {
        throw new BadRequestException('争议已结案');
      }

      const entry: DisputeEvidenceEntry = {
        by: userId,
        role: isMerchant ? 'merchant' : 'creator',
        statement,
        at: new Date().toISOString(),
      };
      dispute.evidence = [...(dispute.evidence ?? []), entry];
      return repo.save(dispute);
    });
  }

  /**
   * 人工裁决（HTTP 表在 T17）。
   * - payout：名额回 passed + survival_override，复用 T14 入队逻辑（同一事务内）；
   * - refund：escrow → 商家 P，名额 refunded，订单完成态复核；
   * - clawback：接单方 → 商家 min(P, 可用余额)，不足记违约 + 差额。
   */
  async resolve(
    disputeId: string,
    ruling: DisputeRuling,
    adminId: string,
    note?: string,
  ): Promise<Dispute> {
    const text = (note ?? '').trim();
    if (ruling === 'payout') return this.resolvePayout(disputeId, adminId, text);
    if (ruling === 'refund') return this.resolveRefund(disputeId, adminId, text);
    if (ruling === 'clawback') return this.resolveClawback(disputeId, adminId, text);
    throw new BadRequestException('未知裁决类型');
  }

  private async resolvePayout(
    disputeId: string,
    adminId: string,
    note: string,
  ): Promise<Dispute> {
    return this.dataSource.transaction(async (tx) => {
      const { dispute, order, slot } = await this.lockDisputeOrderSlot(tx, disputeId);
      if (slot.status !== 'disputed') {
        throw new BadRequestException('当前名额状态不可裁决放款');
      }

      slot.status = 'passed';
      // 人工裁决放行：T14 payout handler 跳过存活复检，避免被已删推文弹回。
      slot.survivalOverride = true;
      await tx.getRepository(OrderSlot).save(slot);

      // 复用 T14 的入队逻辑（同事务内查 pending → 插入，保证裁决即排期）。
      await this.settlement.ensurePayoutJob(slot.id, tx);

      const rulingText = this.buildRulingText('payout', note);
      await this.finishDispute(tx, dispute, order, slot, 'resolved_payout', rulingText, adminId, note, {});
      return dispute;
    });
  }

  private async resolveRefund(
    disputeId: string,
    adminId: string,
    note: string,
  ): Promise<Dispute> {
    return this.dataSource.transaction(async (tx) => {
      const { dispute, order, slot } = await this.lockDisputeOrderSlot(tx, disputeId);
      if (slot.status !== 'disputed') {
        throw new BadRequestException('当前名额状态不可裁决退款');
      }

      const priceMicro = order.priceMicro;
      if (order.escrowMicro < priceMicro) {
        // DB 无 CHECK：这里断言退款额不超过订单托管。
        throw new InternalServerErrorException('托管不变量异常：退款额超过订单托管');
      }

      await this.ledger.transfer(tx, {
        from: { platform: 'escrow' },
        to: { userId: order.merchantUserId },
        amountMicro: priceMicro,
        kind: 'order_refund',
        ref: { type: 'slot', id: slot.id },
      });
      order.escrowMicro -= priceMicro;

      slot.status = 'refunded';
      await tx.getRepository(OrderSlot).save(slot);
      await this.refreshOrderCompletion(tx, order);

      const rulingText = this.buildRulingText('refund', note);
      await this.finishDispute(tx, dispute, order, slot, 'resolved_refund', rulingText, adminId, note, {});
      return dispute;
    });
  }

  private async resolveClawback(
    disputeId: string,
    adminId: string,
    note: string,
  ): Promise<Dispute> {
    return this.dataSource.transaction(async (tx) => {
      const { dispute, order, slot } = await this.lockDisputeOrderSlot(tx, disputeId);
      if (slot.status !== 'paid') {
        throw new BadRequestException('当前名额状态不可执行删帖追回');
      }

      const priceMicro = order.priceMicro;

      // 账户锁按 account.id 升序（与 ledger 一致，防死锁）。
      const creatorAccount = await this.ledger.getOrCreateAccount(tx, {
        userId: slot.creatorUserId,
      });
      const merchantAccount = await this.ledger.getOrCreateAccount(tx, {
        userId: order.merchantUserId,
      });
      const locked = new Map<string, Account>();
      for (const accountId of [creatorAccount.id, merchantAccount.id].sort()) {
        const row = await tx.getRepository(Account).findOne({
          where: { id: accountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (row) locked.set(accountId, row);
      }
      const creator = locked.get(creatorAccount.id)!;

      // 自买自接（同一账户）时无实际划转，视为已全额回收。
      const sameAccount = creatorAccount.id === merchantAccount.id;
      const recovered = sameAccount
        ? priceMicro
        : creator.available < priceMicro
          ? creator.available
          : priceMicro;
      if (recovered > 0n && !sameAccount) {
        await this.ledger.transfer(tx, {
          from: { userId: slot.creatorUserId },
          to: { userId: order.merchantUserId },
          amountMicro: recovered,
          kind: 'deletion_clawback',
          ref: { type: 'slot', id: slot.id },
        });
      }

      const shortfall = priceMicro - recovered;
      if (shortfall > 0n) {
        await tx.getRepository(User).increment({ id: slot.creatorUserId }, 'violations', 1);
      }

      const rulingText = this.buildRulingText('clawback', note, recovered, shortfall);
      await this.finishDispute(tx, dispute, order, slot, 'resolved_clawback', rulingText, adminId, note, {
        recoveredMicro: String(recovered),
        shortfallMicro: String(shortfall),
      });
      return dispute;
    });
  }

  /** 锁争议行（必须 open）+ 订单行 + 名额行。 */
  private async lockDisputeOrderSlot(
    tx: EntityManager,
    disputeId: string,
  ): Promise<{ dispute: Dispute; order: Order; slot: OrderSlot }> {
    const dispute = await tx.getRepository(Dispute).findOne({
      where: { id: disputeId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!dispute) {
      throw new NotFoundException('争议不存在');
    }
    if (dispute.status !== 'open') {
      throw new BadRequestException('争议已结案');
    }

    const preview = await tx.getRepository(OrderSlot).findOne({
      where: { id: dispute.slotId },
    });
    if (!preview) {
      throw new NotFoundException('名额不存在');
    }
    const order = await tx.getRepository(Order).findOne({
      where: { id: preview.orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) {
      throw new NotFoundException('商单不存在');
    }
    const slot = await tx.getRepository(OrderSlot).findOne({
      where: { id: dispute.slotId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!slot) {
      throw new NotFoundException('名额不存在');
    }
    return { dispute, order, slot };
  }

  /** 预读名额找到订单，锁订单行 → 锁名额行（take / 放款 / 关单同一锁序）。 */
  private async lockOrderAndSlot(
    tx: EntityManager,
    slotId: string,
  ): Promise<{ order: Order; slot: OrderSlot }> {
    const preview = await tx.getRepository(OrderSlot).findOne({
      where: { id: slotId },
    });
    if (!preview) {
      throw new NotFoundException('名额不存在');
    }
    const order = await tx.getRepository(Order).findOne({
      where: { id: preview.orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) {
      throw new NotFoundException('商单不存在');
    }
    const slot = await tx.getRepository(OrderSlot).findOne({
      where: { id: slotId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!slot) {
      throw new NotFoundException('名额不存在');
    }
    return { order, slot };
  }

  /**
   * 先查再建给友好 409；并发窗口由部分唯一索引 uq_disputes_open_slot 兜底
   *（违反时 catch 23505 → Conflict）。
   */
  private async assertNoOpenDispute(tx: EntityManager, slotId: string): Promise<void> {
    const existing = await tx
      .getRepository(Dispute)
      .findOne({ where: { slotId, status: 'open' } });
    if (existing) {
      throw new ConflictException('该名额已有进行中的争议');
    }
  }

  private async createOpenDispute(
    tx: EntityManager,
    p: {
      slot: OrderSlot;
      order: Order;
      kind: DisputeKind;
      statement: string;
    },
  ): Promise<Dispute> {
    const repo = tx.getRepository(Dispute);
    return repo.save(
      repo.create({
        slotId: p.slot.id,
        orderId: p.order.id,
        raisedBy: 'merchant',
        kind: p.kind,
        statement: p.statement,
        evidence: [],
        status: 'open',
        ruling: null,
        resolvedBy: null,
        resolvedAt: null,
        arbiterMeta: {},
      }),
    );
  }

  private async notifyOpened(
    tx: EntityManager,
    order: Order,
    slot: OrderSlot,
    kind: DisputeKind,
  ): Promise<void> {
    const ref = { type: 'slot', id: slot.id };
    await this.notifications.notify(tx, {
      userId: order.merchantUserId,
      kind: NOTIFY_DISPUTE_OPENED,
      title: kind === 'deletion' ? '删帖举报已提交' : '争议已提交',
      body:
        kind === 'deletion'
          ? `「${order.title}」的删帖举报已提交，平台将复核并追回款项。`
          : `「${order.title}」的争议已提交，平台人工复核期间暂停自动放款。`,
      ref,
    });
    await this.notifications.notify(tx, {
      userId: slot.creatorUserId,
      kind: NOTIFY_DISPUTE_OPENED,
      title: kind === 'deletion' ? '商家举报你删除了交付推文' : '商家对你的交付发起争议',
      body:
        kind === 'deletion'
          ? `商家举报你对「${order.title}」的交付推文已被删除，平台将复核，你可以在争议中回应。`
          : `商家对「${order.title}」的交付发起争议，请在平台复核期间及时回应。`,
      ref,
    });
  }

  /** 完成态复核（同 T14）：无活跃名额且 escrow=0 → completed；保存订单。 */
  private async refreshOrderCompletion(tx: EntityManager, order: Order): Promise<void> {
    const active = await tx.getRepository(OrderSlot).count({
      where: {
        orderId: order.id,
        status: In([...ESCROW_HELD_SLOT_STATUSES]),
      },
    });
    if (active === 0 && order.escrowMicro === 0n) {
      order.status = 'completed';
    }
    await tx.getRepository(Order).save(order);
  }

  private async finishDispute(
    tx: EntityManager,
    dispute: Dispute,
    order: Order,
    slot: OrderSlot,
    status: DisputeStatus,
    rulingText: string,
    adminId: string,
    note: string,
    meta: Record<string, any>,
  ): Promise<void> {
    dispute.status = status;
    dispute.ruling = rulingText;
    dispute.resolvedBy = adminId;
    dispute.resolvedAt = new Date();
    dispute.arbiterMeta = { adminId, ...(note ? { note } : {}), ...meta };
    await tx.getRepository(Dispute).save(dispute);

    const ref = { type: 'slot', id: slot.id };
    const body = `「${order.title}」的争议已裁决：${rulingText}。`;
    await this.notifications.notify(tx, {
      userId: order.merchantUserId,
      kind: NOTIFY_DISPUTE_RESOLVED,
      title: '争议裁决完成',
      body,
      ref,
    });
    await this.notifications.notify(tx, {
      userId: slot.creatorUserId,
      kind: NOTIFY_DISPUTE_RESOLVED,
      title: '争议裁决完成',
      body,
      ref,
    });
  }

  private buildRulingText(
    ruling: DisputeRuling,
    note: string,
    recovered?: bigint,
    shortfall?: bigint,
  ): string {
    const head =
      ruling === 'payout'
        ? '放款给接单方'
        : ruling === 'refund'
          ? '退款给商家'
          : '向接单方追回款项';
    let text = note ? `${head}：${note}` : head;
    if (shortfall !== undefined && shortfall > 0n) {
      text += `；已追回 ${formatXm(recovered ?? 0n)} XM，差额 ${formatXm(shortfall)} XM 未能追回`;
    }
    return text;
  }
}
