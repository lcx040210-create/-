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
import { DataSource, EntityManager, Repository } from 'typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { JobFatalError, SchedulerService } from '../jobs/scheduler.service';
import { VerificationJob } from '../jobs/verification-job.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/order.entity';
import { OrderSlot, OrderSlotStatus } from '../slots/order-slot.entity';
import { XNotFoundError, XScraperService } from '../xscraper/xscraper.service';
import { XTweet } from '../xscraper/xscraper.types';
import { evaluateDelivery } from './checks';

export const DELIVERY_JOB_TYPE = 'delivery';
/** 核验通过后的商家确认窗：48 小时，逾期自动放款（T14）。 */
export const CONFIRM_WINDOW_MS = 48 * 60 * 60 * 1000;
export const VERIFICATION_SWEEP_INTERVAL_MS = 60_000;

/** 核验任务 4 次失败进入 manual 时写入名额的人工原因。 */
export const MANUAL_REASON_VERIFICATION = 'verification_manual';
/** 管理员人工打回的默认原因。 */
export const MANUAL_REJECT_REASON = 'manual_reject';

export const NOTIFY_DELIVERY_PASSED = 'delivery_passed';
export const NOTIFY_DELIVERY_REJECTED = 'delivery_rejected';
export const NOTIFY_SLOT_APPEAL = 'slot_appeal';

export interface AdminResolveResult {
  id: string;
  status: OrderSlotStatus;
  confirmedDeadlineAt: Date | null;
}

/**
 * 交付核验：
 * - job handler（type='delivery'）：取推文 → 纯函数核验 → passed / 打回 reserved；
 * - 上游异常抛给轮询器退避，4 次失败由 onManual 把名额标记为人工处理；
 * - 补偿扫描：verifying 但任务丢失（进程崩溃 / 事务外入队失败）时重新入队；
 * - 申诉与人工裁决入口（HTTP 仅开放申诉，人工表留给 T17）。
 */
@Injectable()
export class VerificationService implements OnModuleInit {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @InjectRepository(OrderSlot)
    private readonly slots: Repository<OrderSlot>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(XBinding)
    private readonly bindings: Repository<XBinding>,
    @InjectRepository(VerificationJob)
    private readonly jobs: Repository<VerificationJob>,
    private readonly dataSource: DataSource,
    private readonly scheduler: SchedulerService,
    private readonly scraper: XScraperService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register(
      DELIVERY_JOB_TYPE,
      (job) => this.handleDeliveryJob(job),
      { onManual: (job) => this.onDeliveryManual(job) },
    );
  }

  /**
   * SchedulerService 回调。幂等：
   * - 名额已非 verifying（并发裁决 / 重复任务）→ 静默结束；
   * - 应用结果前在事务内复核状态与交付链接，旧任务的核验结果不会污染新交付。
   */
  private async handleDeliveryJob(job: VerificationJob): Promise<void> {
    const slot = await this.slots.findOne({ where: { id: job.refId } });
    if (!slot || slot.status !== 'verifying') return;
    if (!slot.deliveryUrl) {
      throw new JobFatalError('名额缺少交付链接');
    }

    const binding = await this.bindings.findOne({ where: { userId: slot.creatorUserId } });
    if (!binding) {
      throw new JobFatalError('接单方缺少 X 绑定');
    }
    const order = await this.orders.findOne({ where: { id: slot.orderId } });
    if (!order) {
      throw new JobFatalError('名额关联的商单不存在');
    }

    const deliveryUrl = slot.deliveryUrl;
    let tweet: XTweet;
    try {
      tweet = await this.scraper.getTweet(deliveryUrl);
    } catch (err) {
      if (err instanceof XNotFoundError) {
        // 推文不可见按不通过处理：接单方可改链接再交，每次再交重新入队。
        await this.rejectDelivery(slot.id, ['tweet_not_found'], deliveryUrl, null);
        return;
      }
      // XRateLimitError / XUpstreamError：交给轮询器按 [1m,3m,10m] 退避。
      throw err;
    }

    const result = evaluateDelivery(tweet, {
      handle: binding.handle,
      requirements: order.requirements,
      type: order.type,
    });

    if (result.ok) {
      await this.passDelivery(slot.id, deliveryUrl, tweet);
    } else {
      await this.rejectDelivery(slot.id, result.reasons, deliveryUrl, tweet);
    }
  }

  /** 人工裁决（HTTP 表在 T17）：pass → 同通过路径；fail → 回 reserved。 */
  async adminResolveDelivery(
    slotId: string,
    pass: boolean,
    adminId: string,
  ): Promise<AdminResolveResult> {
    const slot = await this.slots.findOne({ where: { id: slotId } });
    if (!slot) {
      throw new NotFoundException('名额不存在');
    }
    if (slot.status !== 'verifying') {
      throw new BadRequestException('当前名额状态不可人工裁决');
    }

    if (pass) {
      // 人工放行：标记 override，T14 存活复检不得把名额弹回 verifying。
      await this.passDelivery(slotId, null, null, true);
    } else {
      await this.rejectDelivery(slotId, [MANUAL_REJECT_REASON], null, null, adminId);
    }

    const updated = await this.slots.findOneOrFail({ where: { id: slotId } });
    return {
      id: updated.id,
      status: updated.status,
      confirmedDeadlineAt: updated.confirmedDeadlineAt,
    };
  }

  /**
   * 申诉：仅 creator、且存在最近一次驳回。重复申诉幂等（不重复通知）。
   * 标记 appeal_requested 供 T17 人工队列查看。
   */
  async appeal(slotId: string, userId: string): Promise<{ id: string; appealRequested: boolean }> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(OrderSlot);
      const slot = await repo.findOne({
        where: { id: slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot) {
        throw new NotFoundException('名额不存在');
      }
      if (slot.creatorUserId !== userId) {
        throw new ForbiddenException('只能申诉自己的名额');
      }
      if (!slot.lastReject) {
        throw new BadRequestException('当前没有可申诉的驳回记录');
      }
      if (slot.appealRequested) {
        return { id: slot.id, appealRequested: true };
      }

      slot.appealRequested = true;
      await repo.save(slot);
      await this.notifications.notify(tx, {
        userId,
        kind: NOTIFY_SLOT_APPEAL,
        title: '申诉已受理',
        body: '你的交付驳回申诉已提交，管理员将尽快人工复核。',
        ref: { type: 'slot', id: slot.id },
      });

      return { id: slot.id, appealRequested: true };
    });
  }

  @Interval(VERIFICATION_SWEEP_INTERVAL_MS)
  async sweepLoop(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.sweepOrphanVerifying();
    } catch (err) {
      this.logger.error(
        `核验补偿扫描失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
  }

  /**
   * 补偿扫描：verifying 名额若不存在**当前交付轮次**的 (pending/done/manual)
   * delivery 任务，说明事务外入队失败或进程在入队前崩溃，重新入队。
   *
   * 轮次判定：job.created_at >= slot.delivered_at。上一轮打回留下的 done job
   * 不算覆盖，否则「打回 → 重交 → 入队失败」会让名额永久卡在 verifying。
   * 返回本次补入队数量。
   */
  async sweepOrphanVerifying(): Promise<number> {
    const verifying = await this.slots.find({
      where: { status: 'verifying' },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    if (verifying.length === 0) return 0;

    const slotIds = verifying.map((slot) => slot.id);
    const coveredRows: Array<{ refId: string }> = await this.jobs.manager.query(
      `SELECT DISTINCT j."ref_id" AS "refId"
         FROM "verification_jobs" j
         JOIN "order_slots" s ON s."id"::text = j."ref_id"
        WHERE j."type" = $1
          AND j."status" = ANY($2::text[])
          AND j."ref_id" = ANY($3::text[])
          AND s."status" = 'verifying'
          AND s."delivered_at" IS NOT NULL
          AND j."created_at" >= s."delivered_at"`,
      [DELIVERY_JOB_TYPE, ['pending', 'done', 'manual'], slotIds],
    );
    const covered = new Set(coveredRows.map((row) => row.refId));

    let enqueued = 0;
    for (const slot of verifying) {
      if (covered.has(slot.id)) continue;
      await this.scheduler.enqueue(DELIVERY_JOB_TYPE, slot.id, {});
      enqueued += 1;
    }
    return enqueued;
  }

  /** 通过：passed + 48h 确认窗 + 快照 + 通知商家。 */
  private async passDelivery(
    slotId: string,
    expectedDeliveryUrl: string | null,
    tweet: XTweet | null,
    survivalOverride = false,
  ): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const slot = await this.lockVerifyingSlot(tx, slotId, expectedDeliveryUrl);
      if (!slot) return;

      const order = await tx.getRepository(Order).findOne({ where: { id: slot.orderId } });
      if (!order) {
        throw new JobFatalError('名额关联的商单不存在');
      }

      slot.status = 'passed';
      slot.confirmedDeadlineAt = new Date(Date.now() + CONFIRM_WINDOW_MS);
      if (survivalOverride) {
        slot.survivalOverride = true;
      }
      if (tweet) {
        slot.verifySnapshot = tweet as unknown as Record<string, any>;
      }
      await tx.getRepository(OrderSlot).save(slot);

      await this.notifications.notify(tx, {
        userId: order.merchantUserId,
        kind: NOTIFY_DELIVERY_PASSED,
        title: '你的订单有交付待确认',
        body: `「${order.title}」已提交交付并通过核验，请在 48 小时内确认，逾期将自动放款。`,
        ref: { type: 'slot', id: slot.id },
      });
    });
  }

  /**
   * 不通过：回 reserved（截止时间不变，不重新计时）+ 留存 last_reject / 快照 +
   * 通知接单方原因。
   */
  private async rejectDelivery(
    slotId: string,
    reasons: string[],
    expectedDeliveryUrl: string | null,
    tweet: XTweet | null,
    adminId?: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const slot = await this.lockVerifyingSlot(tx, slotId, expectedDeliveryUrl);
      if (!slot) return;

      const now = new Date();
      slot.status = 'reserved';
      slot.lastReject = {
        reasons,
        at: now.toISOString(),
        ...(adminId ? { adminId } : {}),
      };
      if (tweet) {
        slot.verifySnapshot = tweet as unknown as Record<string, any>;
      }
      await tx.getRepository(OrderSlot).save(slot);

      await this.notifications.notify(tx, {
        userId: slot.creatorUserId,
        kind: NOTIFY_DELIVERY_REJECTED,
        title: '交付核验未通过',
        body: `交付未通过核验：${reasons.join('、')}。请在交付截止前修改链接重新交付。`,
        ref: { type: 'slot', id: slot.id },
      });
    });
  }

  /** 事务内锁名额并复核 verifying（+ 当前交付链接未变化）；不满足返回 null。 */
  private async lockVerifyingSlot(
    tx: EntityManager,
    slotId: string,
    expectedDeliveryUrl: string | null,
  ): Promise<OrderSlot | null> {
    const repo = tx.getRepository(OrderSlot);
    const slot = await repo.findOne({
      where: { id: slotId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!slot || slot.status !== 'verifying') return null;
    if (expectedDeliveryUrl !== null && slot.deliveryUrl !== expectedDeliveryUrl) {
      // 旧任务：名额已用新链接重新交付，本次核验结果作废。
      return null;
    }
    return slot;
  }

  /**
   * job 进入 manual：名额停在 verifying，原因留给 T17 人工队列。
   * 只认当前交付轮次（job.created_at >= slot.delivered_at）：上一轮的旧 job
   * 失败不能给重新交付后的新轮次盖 manual 标记。
   */
  private async onDeliveryManual(job: VerificationJob): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(OrderSlot);
      const slot = await repo.findOne({
        where: { id: job.refId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot || slot.status !== 'verifying') return;
      if (
        !slot.deliveredAt ||
        !job.createdAt ||
        job.createdAt.getTime() < slot.deliveredAt.getTime()
      ) {
        return;
      }

      const reasons = slot.manualReasons ?? [];
      if (!reasons.includes(MANUAL_REASON_VERIFICATION)) {
        slot.manualReasons = [...reasons, MANUAL_REASON_VERIFICATION];
        await repo.save(slot);
      }
    });
  }
}
