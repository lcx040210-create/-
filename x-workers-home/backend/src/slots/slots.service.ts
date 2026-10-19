import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOperator,
  In,
  LessThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { formatXm, pctFloor } from '../common/money';
import { SchedulerService } from '../jobs/scheduler.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/order.entity';
import { ORDER_FEE_DEN, ORDER_FEE_NUM } from '../orders/orders.service';
import { ReferralService } from '../referral/referral.service';
import { User } from '../users/user.entity';
import { OrderSlot, OrderSlotStatus } from './order-slot.entity';

/** 接单后的交付窗口：3 小时。 */
export const DELIVERY_WINDOW_MS = 3 * 60 * 60 * 1000;
export const SLOT_EXPIRE_INTERVAL_MS = 60_000;

/** 活跃名额判定（防超卖 / 自由池）：expired 回池，其余均占名额。 */
const TAKEN_SLOT_FILTER: FindOperator<OrderSlotStatus> =
  Not<OrderSlotStatus>('expired');
/** 同一用户在一张单内的活跃名额判定（与部分唯一索引一致）。 */
const OWN_ACTIVE_SLOT_FILTER: FindOperator<OrderSlotStatus> = Not<OrderSlotStatus>(
  In<OrderSlotStatus>(['expired', 'refunded']),
);

export interface SlotView {
  id: string;
  orderId: string;
  status: OrderSlotStatus;
  acceptedAt: Date;
  deliverDeadlineAt: Date;
  deliveredAt: Date | null;
  deliveryUrl: string | null;
  lastReject: Record<string, any> | null;
  appealRequested: boolean;
  confirmedDeadlineAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
}

export interface MySlotView extends SlotView {
  order: {
    id: string;
    title: string;
    type: Order['type'];
    priceXm: string;
    payoutXm: string;
    status: Order['status'];
  };
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; driverError?: { code?: string } } | null;
  return (
    candidate?.code === '23505' || candidate?.driverError?.code === '23505'
  );
}

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    @InjectRepository(OrderSlot)
    private readonly slots: Repository<OrderSlot>,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly referral: ReferralService,
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 抢单（防超卖核心）：事务内先锁订单行，再复核状态/剩余名额/本人占位，
   * 首次被抢时同事务收取发单费。所有 take 都串行在同一把订单行锁上，
   * 因此「数名额 → 建名额」之间不存在并发窗口。
   */
  async take(orderId: string, userId: string): Promise<SlotView> {
    let created: OrderSlot;
    try {
      created = await this.dataSource.transaction(async (tx) => {
        const orderRepo = tx.getRepository(Order);
        const order = await orderRepo.findOne({
          where: { id: orderId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) {
          throw new NotFoundException('商单不存在');
        }

        const now = new Date();
        if (order.status !== 'recruiting' || order.expiresAt.getTime() <= now.getTime()) {
          throw new BadRequestException('该商单不可接');
        }

        const slotRepo = tx.getRepository(OrderSlot);
        const taken = await slotRepo.count({
          where: { orderId, status: TAKEN_SLOT_FILTER },
        });
        if (taken >= order.slotsTotal) {
          throw new BadRequestException('名额已满');
        }

        const mine = await slotRepo.count({
          where: { orderId, creatorUserId: userId, status: OWN_ACTIVE_SLOT_FILTER },
        });
        if (mine > 0) {
          throw new BadRequestException('你已在本单中');
        }

        // 首次被抢：fee 从 escrow 转 income，订单托管相应减少；返佣自供资。
        if (!order.feeEarned) {
          await this.chargePostingFee(tx, order);
        }

        return slotRepo.save(
          slotRepo.create({
            orderId,
            creatorUserId: userId,
            status: 'reserved',
            acceptedAt: now,
            deliverDeadlineAt: new Date(now.getTime() + DELIVERY_WINDOW_MS),
            deliveredAt: null,
            deliveryUrl: null,
            lastReject: null,
            verifySnapshot: null,
            manualReasons: [],
            appealRequested: false,
            confirmedDeadlineAt: null,
            settledAt: null,
          }),
        );
      });
    } catch (err) {
      // 部分唯一索引兜底：一个用户一单只能占一个活跃名额。
      if (isUniqueViolation(err)) {
        throw new ConflictException('你已在本单中');
      }
      throw err;
    }

    return this.toView(created);
  }

  /**
   * 交付：锁名额行 → 复核 reserved + 未过 deadline → verifying；
   * 链接已在其他名额出现则 409。事务提交后再入队核验任务（T13 handler）。
   */
  async deliver(slotId: string, userId: string, deliveryUrl: string): Promise<SlotView> {
    const url = deliveryUrl.trim();
    const slot = await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(OrderSlot);
      const row = await repo.findOne({
        where: { id: slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) {
        throw new NotFoundException('名额不存在');
      }
      if (row.creatorUserId !== userId) {
        throw new ForbiddenException('只能交付自己的名额');
      }
      if (row.status !== 'reserved') {
        throw new BadRequestException('当前名额状态不可交付');
      }

      const now = new Date();
      // 恰在 deadline 时刻即视为超时（与 cron 的 <= 语义一致）。
      if (now.getTime() >= row.deliverDeadlineAt.getTime()) {
        throw new BadRequestException('已超过交付截止时间');
      }

      const duplicate = await repo.findOne({
        where: { deliveryUrl: url, id: Not(slotId) },
      });
      if (duplicate) {
        throw new ConflictException('该链接已用于其他名额');
      }

      row.status = 'verifying';
      row.deliveredAt = now;
      row.deliveryUrl = url;
      return repo.save(row);
    });

    await this.scheduler.enqueue('delivery', slot.id, {});

    return this.toView(slot);
  }

  /** 我的接单列表：名额 + 订单摘要（供前端倒计时 / 驳回原因 / 申诉状态）。 */
  async listMine(userId: string): Promise<{ items: MySlotView[] }> {
    const slots = await this.slots.find({
      where: { creatorUserId: userId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    if (slots.length === 0) {
      return { items: [] };
    }

    const orderIds = Array.from(new Set(slots.map((slot) => slot.orderId)));
    const orders = await this.dataSource
      .getRepository(Order)
      .findBy({ id: In(orderIds) });
    const orderById = new Map(orders.map((order) => [order.id, order]));

    return {
      items: slots.map((slot) => {
        const order = orderById.get(slot.orderId)!;
        return {
          ...this.toView(slot),
          order: {
            id: order.id,
            title: order.title,
            type: order.type,
            priceXm: formatXm(order.priceMicro),
            payoutXm: formatXm(
              order.priceMicro -
                pctFloor(order.priceMicro, ORDER_FEE_NUM, ORDER_FEE_DEN),
            ),
            status: order.status,
          },
        };
      }),
    };
  }

  /**
   * 3h 超时扫描：reserved 且 deliver_deadline_at <= now → expired +
   * violations+1 + 站内通知。名额回自由池，escrow 不动。
   */
  @Interval(SLOT_EXPIRE_INTERVAL_MS)
  async expireLoop(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.expireOverdue();
    } catch (err) {
      this.logger.error(
        `名额超时扫描失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
  }

  /** 可注入 now，便于测试推进时间；返回本次过期名额数。 */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const due = await this.slots.find({
      where: { status: 'reserved', deliverDeadlineAt: LessThanOrEqual(now) },
      order: { deliverDeadlineAt: 'ASC' },
      take: 500,
    });

    let expired = 0;
    for (const candidate of due) {
      if (await this.expireOne(candidate.id, now)) {
        expired += 1;
      }
    }
    return expired;
  }

  /** 锁内复核状态与 deadline，避免与并发的交付/重复扫描竞争。 */
  private async expireOne(slotId: string, now: Date): Promise<boolean> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(OrderSlot);
      const slot = await repo.findOne({
        where: { id: slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !slot ||
        slot.status !== 'reserved' ||
        slot.deliverDeadlineAt.getTime() > now.getTime()
      ) {
        return false;
      }

      slot.status = 'expired';
      await repo.save(slot);

      await tx.getRepository(User).increment({ id: slot.creatorUserId }, 'violations', 1);
      await this.notifications.notify(tx, {
        userId: slot.creatorUserId,
        kind: 'slot_expired',
        title: '接单超时已释放',
        body: '你未在 3 小时内提交交付，该名额已回到自由池，并记录一次违约。',
        ref: { type: 'slot', id: slot.id },
      });

      return true;
    });
  }

  /** 首次被抢：escrow → income（fee），标记 fee_earned、扣减订单托管、触发返佣。 */
  private async chargePostingFee(tx: EntityManager, order: Order): Promise<void> {
    if (order.feeMicro > 0n) {
      await this.ledger.transfer(tx, {
        from: { platform: 'escrow' },
        to: { platform: 'income' },
        amountMicro: order.feeMicro,
        kind: 'posting_fee',
        ref: { type: 'order', id: order.id },
      });
      await this.referral.onFeeEvent(tx, {
        userId: order.merchantUserId,
        feeMicro: order.feeMicro,
        feeKind: 'posting_fee',
      });
    }

    order.feeEarned = true;
    order.escrowMicro -= order.feeMicro;
    await tx.getRepository(Order).save(order);
  }

  private toView(slot: OrderSlot): SlotView {
    return {
      id: slot.id,
      orderId: slot.orderId,
      status: slot.status,
      acceptedAt: slot.acceptedAt,
      deliverDeadlineAt: slot.deliverDeadlineAt,
      deliveredAt: slot.deliveredAt,
      deliveryUrl: slot.deliveryUrl,
      lastReject: slot.lastReject,
      appealRequested: slot.appealRequested,
      confirmedDeadlineAt: slot.confirmedDeadlineAt,
      settledAt: slot.settledAt,
      createdAt: slot.createdAt,
    };
  }
}
