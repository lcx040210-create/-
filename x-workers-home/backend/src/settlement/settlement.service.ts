import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import { pctFloor } from '../common/money';
import { JobFatalError, SchedulerService } from '../jobs/scheduler.service';
import { VerificationJob } from '../jobs/verification-job.entity';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/order.entity';
import { ORDER_FEE_DEN, ORDER_FEE_NUM, OrdersService } from '../orders/orders.service';
import { ReferralService } from '../referral/referral.service';
import {
  ESCROW_HELD_SLOT_STATUSES,
  OrderSlot,
  OrderSlotStatus,
} from '../slots/order-slot.entity';
import { XNotFoundError, XScraperService } from '../xscraper/xscraper.service';

export const PAYOUT_JOB_TYPE = 'payout';
export const SETTLEMENT_SWEEP_INTERVAL_MS = 60_000;

/** 存活复检失败（推文已删/不可见）→ 名额转人工的原因。 */
export const MANUAL_REASON_SURVIVAL = 'survival_failed';
/** 自动放款反复遇到上游错误 → 名额转人工的原因。 */
export const MANUAL_REASON_PAYOUT = 'payout_manual';

export const NOTIFY_SURVIVAL_FAILED = 'slot_survival_failed';
export const NOTIFY_PAYOUT_MANUAL = 'slot_payout_manual';

export interface ConfirmResult {
  id: string;
  status: OrderSlotStatus;
  /** 本次调用是否新入队 payout job（false = 已有 pending job 或已放款）。 */
  queued: boolean;
}

export interface SettlementSweepResult {
  /** 本次新入队的自动放款任务数。 */
  payouts: number;
  /** 本次到期关闭的商单数。 */
  closedOrders: number;
}

/**
 * 结算（T14）：商家确认 / 48h 自动确认 / 放款前存活复检 / 订单到期关闭。
 *
 * 资金安全要点：
 * - 存活复检（外部 IO）在事务外完成，失败不进入放款事务；
 * - 放款事务锁序 = order 行 → slot 行 → ledger 账户（按 account.id 排序），
 *   与 take / 名额超时 / 关单 / 争议保持一致；
 * - 事务内复核 slot.status='passed'，与争议/人工裁决竞态时安全退出；
 * - 重复 job / 重复确认因状态复核自然幂等。
 */
@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectRepository(OrderSlot)
    private readonly slots: Repository<OrderSlot>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly referral: ReferralService,
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationsService,
    private readonly scraper: XScraperService,
    private readonly ordersService: OrdersService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register(PAYOUT_JOB_TYPE, (job) => this.handlePayoutJob(job), {
      onManual: (job) => this.onPayoutManual(job),
    });
  }

  /**
   * 商家确认放款：passed 且属于该商家 → 幂等入队 payout。
   * 同 slot 至多一个 pending payout job（重复确认 / cron 再扫均不再入队）；
   * 已 paid 时也返回成功（queued=false），保证重试幂等。
   */
  async confirm(slotId: string, userId: string): Promise<ConfirmResult> {
    const slot = await this.slots.findOne({ where: { id: slotId } });
    if (!slot) {
      throw new NotFoundException('名额不存在');
    }
    const order = await this.orders.findOne({ where: { id: slot.orderId } });
    if (!order) {
      throw new NotFoundException('商单不存在');
    }
    if (order.merchantUserId !== userId) {
      throw new ForbiddenException('只能确认自己商单的交付');
    }

    if (slot.status === 'paid') {
      return { id: slot.id, status: slot.status, queued: false };
    }
    if (slot.status !== 'passed') {
      throw new BadRequestException('当前名额状态不可确认');
    }

    const queued = await this.ensurePayoutJob(slot.id);
    return { id: slot.id, status: slot.status, queued };
  }

  @Interval(SETTLEMENT_SWEEP_INTERVAL_MS)
  async sweepLoop(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(
        `结算扫描失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
  }

  /** 可注入 now 的结算扫描（e2e 手动驱动）。幂等：重复扫描不会重复入队/退款。 */
  async sweep(now: Date = new Date()): Promise<SettlementSweepResult> {
    const result: SettlementSweepResult = { payouts: 0, closedOrders: 0 };

    // 1) 48h 确认窗到期：passed → payout（已无 pending job 时才入队）。
    const dueSlots = await this.slots.find({
      where: { status: 'passed', confirmedDeadlineAt: LessThanOrEqual(now) },
      order: { confirmedDeadlineAt: 'ASC' },
      take: 500,
    });
    for (const slot of dueSlots) {
      if (await this.ensurePayoutJob(slot.id)) {
        result.payouts += 1;
      }
    }

    // 2) 招募到期：recruiting 且 expires_at <= now → 关闭并退自由池。
    const dueOrders = await this.orders.find({
      where: { status: 'recruiting', expiresAt: LessThanOrEqual(now) },
      order: { expiresAt: 'ASC' },
      take: 500,
    });
    for (const order of dueOrders) {
      if (await this.ordersService.closeExpired(order.id, now)) {
        result.closedOrders += 1;
      }
    }

    return result;
  }

  /**
   * 同 slot 至多一个 pending payout job；返回是否新入队。
   * 锁名额行串行化「查 pending → 入队」，并发 confirm / cron 不会产生重复 job
   *（重复 job 本身也会被 handler 的状态复核挡掉，这里是第二道防线）。
   */
  private async ensurePayoutJob(slotId: string): Promise<boolean> {
    return this.dataSource.transaction(async (tx) => {
      const slot = await tx.getRepository(OrderSlot).findOne({
        where: { id: slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot || slot.status !== 'passed') return false;

      const jobRepo = tx.getRepository(VerificationJob);
      const pending = await jobRepo.findOne({
        where: { type: PAYOUT_JOB_TYPE, refId: slotId, status: 'pending' },
      });
      if (pending) return false;

      // 与 SchedulerService.enqueue 默认值保持一致。
      await jobRepo.save(
        jobRepo.create({
          type: PAYOUT_JOB_TYPE,
          refId: slotId,
          payload: {},
          status: 'pending',
          attempts: 0,
          nextRunAt: new Date(),
          lastError: null,
        }),
      );
      return true;
    });
  }

  /**
   * payout job handler。
   * 1. 前置幂等：名额已非 passed（重复 job / 争议 / 已放款）→ 静默结束；
   * 2. 存活复检在事务外：XNotFoundError → 名额转人工，不自动放款；
   *    其他上游错误抛出，交给轮询器按 [1m,3m,10m] 退避，4 次失败 → manual；
   * 3. 复检通过 → 事务内锁 order → slot，复核 passed 后放款。
   */
  private async handlePayoutJob(job: VerificationJob): Promise<void> {
    const slot = await this.slots.findOne({ where: { id: job.refId } });
    if (!slot || slot.status !== 'passed') return;
    if (!slot.deliveryUrl) {
      throw new JobFatalError('名额缺少交付链接');
    }

    // 放款前存活复检（事务外，避免长时间持有行锁）。
    try {
      await this.scraper.getTweet(slot.deliveryUrl);
    } catch (err) {
      if (err instanceof XNotFoundError) {
        await this.markManual(slot.id, MANUAL_REASON_SURVIVAL);
        return;
      }
      // XUpstreamError / XRateLimitError：交给轮询器退避。
      throw err;
    }

    await this.payout(slot.id);
  }

  /**
   * 放款事务。锁序：order 行 → slot 行 → ledger 账户（ledger 内部按 id 排序）。
   * 名额已非 passed（与 T15 争议 / 人工裁决竞态）时静默退出，资金不动。
   */
  private async payout(slotId: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const slotRepo = tx.getRepository(OrderSlot);
      const preview = await slotRepo.findOne({ where: { id: slotId } });
      if (!preview) return;

      const orderRepo = tx.getRepository(Order);
      const order = await orderRepo.findOne({
        where: { id: preview.orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) return;

      const slot = await slotRepo.findOne({
        where: { id: slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot || slot.status !== 'passed') return;

      const priceMicro = order.priceMicro;
      const feeMicro = pctFloor(priceMicro, ORDER_FEE_NUM, ORDER_FEE_DEN);
      const payoutMicro = priceMicro - feeMicro;
      if (order.escrowMicro < priceMicro) {
        throw new JobFatalError('托管不变量异常：放款额超过订单托管');
      }

      const ref = { type: 'slot' as const, id: slot.id };
      await this.ledger.transfer(tx, {
        from: { platform: 'escrow' },
        to: { userId: slot.creatorUserId },
        amountMicro: payoutMicro,
        kind: 'slot_payout',
        ref,
      });
      if (feeMicro > 0n) {
        await this.ledger.transfer(tx, {
          from: { platform: 'escrow' },
          to: { platform: 'income' },
          amountMicro: feeMicro,
          kind: 'completion_fee',
          ref,
        });
        await this.referral.onFeeEvent(tx, {
          userId: order.merchantUserId,
          feeMicro,
          feeKind: 'completion_fee',
        });
      }

      slot.status = 'paid';
      slot.settledAt = new Date();
      order.escrowMicro -= priceMicro;
      await slotRepo.save(slot);
      await orderRepo.save(order);

      // 完成态：无任何活跃名额且托管清零。所有活跃名额的状态迁移都在订单行锁内，
      // 因此此处计数对本事务稳定。
      const active = await slotRepo.count({
        where: { orderId: order.id, status: In([...ESCROW_HELD_SLOT_STATUSES]) },
      });
      if (active === 0 && order.escrowMicro === 0n) {
        order.status = 'completed';
        await orderRepo.save(order);
      }
    });
  }

  /**
   * 存活复检失败 → 名额转人工（沿用 T13 manual 语义：停在 verifying +
   * manual_reasons），并通知商家可举报/等待人工放行。幂等：名额已非 passed 时不动。
   */
  private async markManual(slotId: string, reason: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(OrderSlot);
      const slot = await repo.findOne({
        where: { id: slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot || slot.status !== 'passed') return;

      slot.status = 'verifying';
      const reasons = slot.manualReasons ?? [];
      if (!reasons.includes(reason)) {
        slot.manualReasons = [...reasons, reason];
      }
      await repo.save(slot);

      const order = await tx.getRepository(Order).findOne({ where: { id: slot.orderId } });
      if (!order) return;
      await this.notifications.notify(tx, {
        userId: order.merchantUserId,
        kind: NOTIFY_SURVIVAL_FAILED,
        title: '交付推文已不可见，转人工处理',
        body: `「${order.title}」的交付在放款前复检中发现推文不可见，已转入人工处理，暂不放款。你可在 7 天内举报或等待平台人工放行。`,
        ref: { type: 'slot', id: slot.id },
      });
    });
  }

  /**
   * payout job 4 次重试仍失败（上游不可用 / 托管异常）→ 名额转人工，
   * 避免 cron 每 60s 重新入队形成死循环；商家收到通知。
   */
  private async onPayoutManual(job: VerificationJob): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(OrderSlot);
      const slot = await repo.findOne({
        where: { id: job.refId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot || slot.status !== 'passed') return;

      slot.status = 'verifying';
      const reasons = slot.manualReasons ?? [];
      if (!reasons.includes(MANUAL_REASON_PAYOUT)) {
        slot.manualReasons = [...reasons, MANUAL_REASON_PAYOUT];
      }
      await repo.save(slot);

      const order = await tx.getRepository(Order).findOne({ where: { id: slot.orderId } });
      if (!order) return;
      await this.notifications.notify(tx, {
        userId: order.merchantUserId,
        kind: NOTIFY_PAYOUT_MANUAL,
        title: '自动放款失败，转人工处理',
        body: `「${order.title}」的自动放款多次重试失败，已转入人工处理，平台将尽快完成放款。`,
        ref: { type: 'slot', id: slot.id },
      });
    });
  }
}
