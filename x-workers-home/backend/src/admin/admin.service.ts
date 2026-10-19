import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  Repository,
} from 'typeorm';
import { BindingChange } from '../bindings/binding-change.entity';
import { XBinding } from '../bindings/x-binding.entity';
import { formatXm } from '../common/money';
import { Deposit, DepositStatus } from '../deposits/deposit.entity';
import { DepositView, DepositsService } from '../deposits/deposits.service';
import { Dispute, DisputeRuling, DisputeStatus } from '../disputes/dispute.entity';
import { DisputesService } from '../disputes/disputes.service';
import { VerificationJob } from '../jobs/verification-job.entity';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/order.entity';
import {
  ESCROW_HELD_SLOT_STATUSES,
  OrderSlot,
} from '../slots/order-slot.entity';
import { User } from '../users/user.entity';
import {
  MANUAL_REJECT_REASON,
  VerificationService,
} from '../verification/verification.service';
import { Withdrawal, WithdrawalStatus } from '../withdrawals/withdrawal.entity';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { AdminAction } from './admin-action.entity';
import {
  AdminDepositClaimDto,
  AdminOrderListDto,
} from './dto/admin.dto';

export const ADMIN_TOKEN_TTL = '12h';
export const ADMIN_LIST_LIMIT = 200;
export const ADMIN_ORDER_PAGE_SIZE = 20;

export const NOTIFY_PENALTY_COMPENSATION = 'order_penalized_compensation';
export const NOTIFY_PENALTY_SLOT_CLOSED = 'order_penalized_slot_closed';
export const NOTIFY_PENALTY_MERCHANT = 'order_penalized_merchant';

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

/**
 * 管理后台（T17）：登录、审核队列、抽查、罚则。
 *
 * 资金动作（罚则）全部在一个事务内完成：
 * order 行锁 → 名额行锁 → ledger（账户按 id 升序）。
 * 托管/余额守恒：escrow 全额 → income；income → 善意接单方（P）；
 * 商家 forfeitAll → income。全程只有 transfer，系统总额不变。
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Withdrawal)
    private readonly withdrawals: Repository<Withdrawal>,
    @InjectRepository(Deposit) private readonly deposits: Repository<Deposit>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderSlot) private readonly slots: Repository<OrderSlot>,
    @InjectRepository(VerificationJob)
    private readonly jobs: Repository<VerificationJob>,
    @InjectRepository(BindingChange)
    private readonly bindingChanges: Repository<BindingChange>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    @InjectRepository(AdminAction)
    private readonly actions: Repository<AdminAction>,
    @InjectRepository(XBinding)
    private readonly xBindings: Repository<XBinding>,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly depositsService: DepositsService,
    private readonly verification: VerificationService,
    private readonly disputesService: DisputesService,
    private readonly notifications: NotificationsService,
    private readonly jwt: JwtService,
  ) {}

  /** 管理员登录：仅 role='admin' 且 active 的账号；统一 401 避免账号枚举。 */
  async login(addressRaw: string, password: string) {
    const address = addressRaw.trim().toLowerCase();
    const user = await this.users.findOne({ where: { address } });
    const invalid = !user
      ? true
      : user.role !== 'admin' ||
        user.status !== 'active' ||
        !user.passwordHash;
    if (invalid) {
      throw new UnauthorizedException('账号或密码错误');
    }
    const matched = await bcrypt.compare(password, user!.passwordHash!);
    if (!matched) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const accessToken = await this.jwt.signAsync(
      { sub: user!.id, role: user!.role },
      { secret: process.env.JWT_SECRET, expiresIn: ADMIN_TOKEN_TTL },
    );
    return {
      accessToken,
      user: {
        id: user!.id,
        address: user!.address,
        role: user!.role,
        status: user!.status,
        nickname: user!.nickname,
      },
    };
  }

  // ---------------------------------------------------------------------
  // 提现审核
  // ---------------------------------------------------------------------

  async listWithdrawals(status?: WithdrawalStatus) {
    const rows = await this.withdrawals.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      take: ADMIN_LIST_LIMIT,
    });
    if (rows.length === 0) return [];

    const userIds = uniqueIds(rows.map((row) => row.userId));
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [users, lastPaidRows, paidCounts, recentCounts] = await Promise.all([
      this.users.findBy({ id: In(userIds) }),
      this.withdrawals
        .createQueryBuilder('w')
        .where('w.userId IN (:...userIds)', { userIds })
        .andWhere('w.status = :paid', { paid: 'paid' })
        .orderBy('w.reviewedAt', 'DESC', 'NULLS LAST')
        .addOrderBy('w.createdAt', 'DESC')
        .getMany(),
      this.withdrawals.query(
        `SELECT "user_id" AS "userId", COUNT(*)::int AS "count"
           FROM "withdrawals"
          WHERE "user_id" = ANY($1::uuid[]) AND "status" = 'paid'
          GROUP BY "user_id"`,
        [userIds],
      ) as Promise<Array<{ userId: string; count: number }>>,
      this.withdrawals.query(
        `SELECT "user_id" AS "userId", COUNT(*)::int AS "count"
           FROM "withdrawals"
          WHERE "user_id" = ANY($1::uuid[]) AND "created_at" > now() - interval '24 hours'
          GROUP BY "user_id"`,
        [userIds],
      ) as Promise<Array<{ userId: string; count: number }>>,
    ]);

    const userById = new Map(users.map((user) => [user.id, user]));
    const paidCountByUser = new Map(paidCounts.map((row) => [row.userId, row.count]));
    const recentCountByUser = new Map(
      recentCounts.map((row) => [row.userId, row.count]),
    );
    const lastPaidByUser = new Map<string, Withdrawal>();
    for (const paid of lastPaidRows) {
      if (!lastPaidByUser.has(paid.userId)) {
        lastPaidByUser.set(paid.userId, paid);
      }
    }

    return rows.map((row) => {
      const user = userById.get(row.userId);
      const lastPaid = lastPaidByUser.get(row.userId);
      const recent = recentCountByUser.get(row.userId) ?? 0;
      const selfInWindow = row.createdAt.getTime() > cutoff.getTime();
      return {
        id: row.id,
        userId: row.userId,
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
        user: user
          ? {
              id: user.id,
              address: user.address,
              nickname: user.nickname,
              status: user.status,
            }
          : null,
        isFirst: (paidCountByUser.get(row.userId) ?? 0) === 0,
        isNewAddress: !lastPaid || lastPaid.address !== row.address,
        flagged24h: recent - (selfInWindow ? 1 : 0) > 0,
      };
    });
  }

  async approveWithdrawal(id: string, adminId: string) {
    const summary = { withdrawalId: id };
    const auditId = await this.startIntentAudit({
      adminUserId: adminId,
      action: 'withdrawal_approve',
      targetType: 'withdrawal',
      targetId: id,
      detail: summary,
    });
    try {
      const view = await this.withdrawalsService.approve(id, adminId);
      await this.finishIntentAudit(auditId, {
        ...summary,
        address: view.address,
        amountXm: view.amountXm,
        status: view.status,
      });
      return view;
    } catch (err) {
      await this.failIntentAudit(auditId, summary, err);
      throw err;
    }
  }

  async markWithdrawalPaid(id: string, txHash: string, adminId: string) {
    const summary = { withdrawalId: id, txHash };
    const auditId = await this.startIntentAudit({
      adminUserId: adminId,
      action: 'withdrawal_paid',
      targetType: 'withdrawal',
      targetId: id,
      detail: summary,
    });
    try {
      const view = await this.withdrawalsService.markPaid(id, txHash, adminId);
      await this.finishIntentAudit(auditId, {
        ...summary,
        payoutXm: view.payoutXm,
        status: view.status,
      });
      return view;
    } catch (err) {
      await this.failIntentAudit(auditId, summary, err);
      throw err;
    }
  }

  async rejectWithdrawal(id: string, reason: string, adminId: string) {
    const summary = { withdrawalId: id, reason };
    const auditId = await this.startIntentAudit({
      adminUserId: adminId,
      action: 'withdrawal_reject',
      targetType: 'withdrawal',
      targetId: id,
      detail: summary,
    });
    try {
      const view = await this.withdrawalsService.reject(id, reason, adminId);
      await this.finishIntentAudit(auditId, { ...summary, status: view.status });
      return view;
    } catch (err) {
      await this.failIntentAudit(auditId, summary, err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // 充值认领
  // ---------------------------------------------------------------------

  async listDeposits(status?: DepositStatus): Promise<DepositView[]> {
    const rows = await this.deposits.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      take: ADMIN_LIST_LIMIT,
    });
    return rows.map((row) => this.toDepositView(row));
  }

  async claimDeposit(
    depositId: string,
    dto: AdminDepositClaimDto,
    adminId: string,
  ): Promise<DepositView> {
    let userId = dto.userId?.trim();
    if (dto.userAddress) {
      const user = await this.users.findOne({
        where: { address: dto.userAddress.trim().toLowerCase() },
      });
      if (!user) {
        throw new NotFoundException('用户不存在');
      }
      userId = user.id;
    }
    if (!userId) {
      throw new BadRequestException('请提供 userAddress 或 userId');
    }

    const summary = {
      depositId,
      userId,
      userAddress: dto.userAddress ?? null,
    };
    const auditId = await this.startIntentAudit({
      adminUserId: adminId,
      action: 'deposit_claim',
      targetType: 'deposit',
      targetId: depositId,
      detail: summary,
    });
    try {
      const view = await this.depositsService.claimTo(depositId, userId);
      await this.finishIntentAudit(auditId, {
        ...summary,
        amountMicro: view.amountMicro,
        status: view.status,
      });
      return view;
    } catch (err) {
      await this.failIntentAudit(auditId, summary, err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // 人工待核队列
  // ---------------------------------------------------------------------

  async manualQueue() {
    const [jobs, appeals, manualSlots] = await Promise.all([
      this.jobs.find({
        where: { status: 'manual' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: ADMIN_LIST_LIMIT,
      }),
      this.slots.find({
        where: { appealRequested: true },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: ADMIN_LIST_LIMIT,
      }),
      this.slots
        .createQueryBuilder('s')
        .where(`s."manual_reasons" <> '[]'::jsonb`)
        .orderBy('s.createdAt', 'DESC')
        .addOrderBy('s.id', 'DESC')
        .take(ADMIN_LIST_LIMIT)
        .getMany(),
    ]);

    const allSlots = [...appeals, ...manualSlots];
    const slotViews = await this.slotAdminViews(allSlots);
    const viewById = new Map(slotViews.map((view) => [view.id, view]));

    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        type: job.type,
        refId: job.refId,
        payload: job.payload,
        status: job.status,
        attempts: job.attempts,
        nextRunAt: job.nextRunAt,
        lastError: job.lastError,
        createdAt: job.createdAt,
        slot: viewById.get(job.refId) ?? null,
      })),
      appeals: appeals.map((slot) => viewById.get(slot.id)),
      slots: manualSlots.map((slot) => viewById.get(slot.id)),
    };
  }

  /**
   * 人工裁决交付：
   * - verifying：走 T13 adminResolveDelivery（pass 会写 survival_override）；
   * - reserved + appeal_requested：先把名额提回 verifying 再复用同一路径；
   *   fail 则保留 reserved、记录管理员驳回原因。
   * 处理完成清理 appeal_requested / manual_reasons，避免人工队列残留。
   */
  async resolveDelivery(slotId: string, pass: boolean, adminId: string) {
    const slot = await this.slots.findOne({ where: { id: slotId } });
    if (!slot) {
      throw new NotFoundException('名额不存在');
    }

    const summary = { slotId, pass };
    const auditId = await this.startIntentAudit({
      adminUserId: adminId,
      action: 'slot_resolve_delivery',
      targetType: 'slot',
      targetId: slotId,
      detail: summary,
    });

    try {
      let result: { id: string; status: any; confirmedDeadlineAt: Date | null };

      if (slot.status === 'verifying') {
        result = await this.verification.adminResolveDelivery(slotId, pass, adminId);
      } else if (slot.status === 'reserved' && slot.appealRequested && slot.deliveredAt) {
        if (pass) {
          await this.dataSource.transaction(async (tx) => {
            const repo = tx.getRepository(OrderSlot);
            const locked = await repo.findOne({
              where: { id: slotId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!locked || locked.status !== 'reserved' || !locked.deliveredAt) {
              throw new BadRequestException('当前名额状态不可人工裁决');
            }
            locked.status = 'verifying';
            await repo.save(locked);
          });
          result = await this.verification.adminResolveDelivery(slotId, true, adminId);
        } else {
          await this.dataSource.transaction(async (tx) => {
            const repo = tx.getRepository(OrderSlot);
            const locked = await repo.findOne({
              where: { id: slotId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!locked || locked.status !== 'reserved') {
              throw new BadRequestException('当前名额状态不可人工裁决');
            }
            locked.lastReject = {
              reasons: [MANUAL_REJECT_REASON],
              at: new Date().toISOString(),
              adminId,
            };
            locked.appealRequested = false;
            locked.manualReasons = [];
            await repo.save(locked);
          });
          result = { id: slotId, status: 'reserved', confirmedDeadlineAt: null };
        }
      } else {
        // 非人工可裁决状态：交给 T13 服务抛出精确的 400。
        result = await this.verification.adminResolveDelivery(slotId, pass, adminId);
      }

      await this.slots.update(
        { id: slotId },
        { appealRequested: false, manualReasons: [] },
      );
      await this.finishIntentAudit(auditId, {
        ...summary,
        status: result.status,
      });
      return result;
    } catch (err) {
      await this.failIntentAudit(auditId, summary, err);
      throw err;
    }
  }

  async retryJob(jobId: string, adminId: string) {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('任务不存在');
    }
    if (job.status !== 'manual' && job.status !== 'failed') {
      throw new BadRequestException('只有人工/失败任务可以重试');
    }

    job.status = 'pending';
    job.attempts = 0;
    job.nextRunAt = new Date();
    job.lastError = null;
    const saved = await this.jobs.save(job);

    await this.audit(null, {
      adminUserId: adminId,
      action: 'job_retry',
      targetType: 'job',
      targetId: jobId,
      detail: { type: saved.type, refId: saved.refId },
    });
    return {
      id: saved.id,
      type: saved.type,
      refId: saved.refId,
      payload: saved.payload,
      status: saved.status,
      attempts: saved.attempts,
      nextRunAt: saved.nextRunAt,
      lastError: saved.lastError,
      createdAt: saved.createdAt,
    };
  }

  // ---------------------------------------------------------------------
  // 争议
  // ---------------------------------------------------------------------

  async listDisputes(status?: 'open' | 'all') {
    const filter: { status?: DisputeStatus } =
      status === 'all' ? {} : { status: 'open' };
    const rows = await this.disputes.find({
      where: filter,
      order: { createdAt: 'DESC', id: 'DESC' },
      take: ADMIN_LIST_LIMIT,
    });
    if (rows.length === 0) return [];

    const orderIds = uniqueIds(rows.map((row) => row.orderId));
    const slotIds = uniqueIds(rows.map((row) => row.slotId));
    const [orders, slots] = await Promise.all([
      this.orders.findBy({ id: In(orderIds) }),
      this.slots.findBy({ id: In(slotIds) }),
    ]);
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const slotById = new Map(slots.map((slot) => [slot.id, slot]));

    return rows.map((dispute) => {
      const order = orderById.get(dispute.orderId);
      const slot = slotById.get(dispute.slotId);
      return {
        id: dispute.id,
        slotId: dispute.slotId,
        orderId: dispute.orderId,
        raisedBy: dispute.raisedBy,
        kind: dispute.kind,
        statement: dispute.statement,
        evidence: dispute.evidence ?? [],
        status: dispute.status,
        ruling: dispute.ruling,
        resolvedBy: dispute.resolvedBy,
        resolvedAt: dispute.resolvedAt,
        arbiterMeta: dispute.arbiterMeta,
        createdAt: dispute.createdAt,
        order: order
          ? {
              id: order.id,
              title: order.title,
              status: order.status,
              merchantUserId: order.merchantUserId,
              priceXm: formatXm(order.priceMicro),
            }
          : null,
        slot: slot
          ? {
              id: slot.id,
              creatorUserId: slot.creatorUserId,
              status: slot.status,
              deliveryUrl: slot.deliveryUrl,
            }
          : null,
      };
    });
  }

  async resolveDispute(
    id: string,
    ruling: DisputeRuling,
    note: string | undefined,
    adminId: string,
  ) {
    const summary = { disputeId: id, ruling, note: note ?? null };
    const auditId = await this.startIntentAudit({
      adminUserId: adminId,
      action: 'dispute_resolve',
      targetType: 'dispute',
      targetId: id,
      detail: summary,
    });
    try {
      const dispute = await this.disputesService.resolve(id, ruling, adminId, note);
      await this.finishIntentAudit(auditId, {
        ...summary,
        orderId: dispute.orderId,
        status: dispute.status,
      });
      return dispute;
    } catch (err) {
      await this.failIntentAudit(auditId, summary, err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // 抽查
  // ---------------------------------------------------------------------

  async listOrders(query: AdminOrderListDto) {
    const page = Math.max(1, query.page ?? 1);
    const qb = this.orders.createQueryBuilder('o');

    if (query.type) {
      qb.andWhere('o.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('o.status = :status', { status: query.status });
    }
    const q = query.q?.trim();
    if (q) {
      const like = `%${q}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('o.title ILIKE :like', { like })
            .orWhere('o.id::text ILIKE :like', { like })
            .orWhere(
              `o."merchant_user_id" IN (
                 SELECT mu."id" FROM "users" mu WHERE mu."address" ILIKE :like
               )`,
              { like },
            );
        }),
      );
    }

    qb.orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .skip((page - 1) * ADMIN_ORDER_PAGE_SIZE)
      .take(ADMIN_ORDER_PAGE_SIZE);

    const [rows, total] = await qb.getManyAndCount();
    const merchants = rows.length
      ? await this.users.findBy({
          id: In(uniqueIds(rows.map((row) => row.merchantUserId))),
        })
      : [];
    const merchantById = new Map(merchants.map((user) => [user.id, user]));

    return {
      items: rows.map((order) => ({
        ...this.toOrderSummary(order),
        merchant: this.merchantView(merchantById.get(order.merchantUserId)),
      })),
      total,
      page,
      pageSize: ADMIN_ORDER_PAGE_SIZE,
    };
  }

  async orderDetail(id: string) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException('商单不存在');
    }

    const [slotRows, disputeRows, merchant] = await Promise.all([
      this.slots.find({
        where: { orderId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.disputes.find({
        where: { orderId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.users.findOne({ where: { id: order.merchantUserId } }),
    ]);

    const creators = slotRows.length
      ? await this.users.findBy({
          id: In(uniqueIds(slotRows.map((slot) => slot.creatorUserId))),
        })
      : [];
    const creatorById = new Map(creators.map((user) => [user.id, user]));

    return {
      ...this.toOrderSummary(order),
      brief: order.brief,
      requirements: order.requirements,
      targetTweetUrl: order.targetTweetUrl,
      feeEarned: order.feeEarned,
      merchant: this.merchantView(merchant),
      slots: slotRows.map((slot) => {
        const creator = creatorById.get(slot.creatorUserId);
        return {
          id: slot.id,
          orderId: slot.orderId,
          creatorUserId: slot.creatorUserId,
          creator: creator
            ? {
                id: creator.id,
                address: creator.address,
                nickname: creator.nickname,
                status: creator.status,
              }
            : null,
          status: slot.status,
          acceptedAt: slot.acceptedAt,
          deliverDeadlineAt: slot.deliverDeadlineAt,
          deliveredAt: slot.deliveredAt,
          deliveryUrl: slot.deliveryUrl,
          deliveryTweetId: slot.deliveryTweetId,
          lastReject: slot.lastReject,
          verifySnapshot: slot.verifySnapshot,
          manualReasons: slot.manualReasons ?? [],
          appealRequested: slot.appealRequested,
          confirmedDeadlineAt: slot.confirmedDeadlineAt,
          settledAt: slot.settledAt,
          survivalOverride: slot.survivalOverride,
          createdAt: slot.createdAt,
        };
      }),
      disputes: disputeRows.map((dispute) => ({
        id: dispute.id,
        slotId: dispute.slotId,
        kind: dispute.kind,
        status: dispute.status,
        statement: dispute.statement,
        evidence: dispute.evidence ?? [],
        ruling: dispute.ruling,
        resolvedBy: dispute.resolvedBy,
        resolvedAt: dispute.resolvedAt,
        arbiterMeta: dispute.arbiterMeta,
        createdAt: dispute.createdAt,
      })),
    };
  }

  // ---------------------------------------------------------------------
  // 罚则
  // ---------------------------------------------------------------------

  /**
   * 罚则编排（单事务）：
   * 1) 订单关闭，当前 escrow 全额 → platform_income（kind=forfeit）；
   * 2) 善意已交付（delivered_at != null，且未 paid/refunded）的名额：
   *    income → creator 按 P 全额补发（memo=违规单补发），名额 refunded；
   * 3) 未交付的托管名额 → expired；
   * 4) 商家 forfeitAll → income，账号 suspended；
   * 5) 已 paid 名额不动；写 admin_actions + 通知受影响 KOL。
   */
  async penalizeOrder(orderId: string, reason: string, adminId: string) {
    return this.dataSource.transaction(async (tx) => {
      const orderRepo = tx.getRepository(Order);
      const order = await orderRepo.findOne({
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException('商单不存在');
      }

      // 幂等：必须在拿到订单行锁之后再查审计（并发罚则串行化后可见前一次提交）。
      const prior = await tx.getRepository(AdminAction).findOne({
        where: {
          action: 'order_penalize',
          targetType: 'order',
          targetId: orderId,
        },
      });
      if (prior) {
        throw new BadRequestException('该商单已执行过罚则');
      }

      const slotRepo = tx.getRepository(OrderSlot);
      const slotRows = await slotRepo.find({
        where: { orderId },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      const heldStatuses = new Set<string>([...ESCROW_HELD_SLOT_STATUSES]);
      const held = slotRows.filter((slot) => heldStatuses.has(slot.status));
      // 善意口径（spec）：delivered_at != null 且非 paid/refunded。
      // 含「交付过但被打回后超时」的 expired 名额——它们同样由平台补发。
      const compensatedSlots = slotRows.filter(
        (slot) =>
          slot.deliveredAt !== null &&
          slot.status !== 'paid' &&
          slot.status !== 'refunded',
      );
      // 未交付且仍在托管中的名额 → expired（reserved；其余状态不可能未交付）。
      const undeliveredSlots = slotRows.filter(
        (slot) => slot.deliveredAt === null && heldStatuses.has(slot.status),
      );

      const priceMicro = order.priceMicro;
      // 托管不变量：每个仍在托管中的名额都占 P（fee 若未赚也含在 escrow）。
      if (order.escrowMicro < priceMicro * BigInt(held.length)) {
        throw new InternalServerErrorException(
          '托管不变量异常：罚则补发额超过订单托管',
        );
      }

      // 1) escrow 全额 → income。
      const escrowForfeited = order.escrowMicro;
      const orderRef = { type: 'order' as const, id: order.id };
      if (escrowForfeited > 0n) {
        await this.ledger.transfer(tx, {
          from: { platform: 'escrow' },
          to: { platform: 'income' },
          amountMicro: escrowForfeited,
          kind: 'forfeit',
          ref: orderRef,
        });
        order.escrowMicro = 0n;
      }

      // 2) 善意已交付：平台按 P 全额补发。
      const compensated: Array<{
        slotId: string;
        userId: string;
        amountMicro: bigint;
      }> = [];
      for (const slot of compensatedSlots) {
        await this.ledger.transfer(tx, {
          from: { platform: 'income' },
          to: { userId: slot.creatorUserId },
          amountMicro: priceMicro,
          kind: 'penalty_compensation',
          ref: orderRef,
          memo: '违规单补发',
        });
        slot.status = 'refunded';
        slot.manualReasons = [];
        slot.appealRequested = false;
        await slotRepo.save(slot);
        compensated.push({
          slotId: slot.id,
          userId: slot.creatorUserId,
          amountMicro: priceMicro,
        });

        await this.notifications.notify(tx, {
          userId: slot.creatorUserId,
          kind: NOTIFY_PENALTY_COMPENSATION,
          title: '商单违规处理，交付已获补偿',
          body: `「${order.title}」因商家违规被平台处理，你已交付的名额由平台按 ${formatXm(priceMicro)} XM 全额补发。`,
          ref: { type: 'slot', id: slot.id },
        });
      }

      // 3) 未交付的托管名额 → expired。
      for (const slot of undeliveredSlots) {
        slot.status = 'expired';
        slot.manualReasons = [];
        slot.appealRequested = false;
        await slotRepo.save(slot);

        await this.notifications.notify(tx, {
          userId: slot.creatorUserId,
          kind: NOTIFY_PENALTY_SLOT_CLOSED,
          title: '商单违规处理，名额已关闭',
          body: `「${order.title}」因商家违规被平台关闭，你尚未交付的名额已释放，不再占用托管。`,
          ref: { type: 'slot', id: slot.id },
        });
      }

      // 4) 订单关闭 + 商家余额全额没收 + 封禁。
      order.status = 'closed';
      order.closedAt = new Date();
      await orderRepo.save(order);

      // 未完成的提现先解冻再随余额一起没收；否则 frozen 被清空后，
      // 提现行会永远卡在 pending/approved（后续 approve/paid/reject 都会 500）。
      const pendingWithdrawals = await tx.getRepository(Withdrawal).find({
        where: {
          userId: order.merchantUserId,
          status: In(['pending', 'approved'] as WithdrawalStatus[]),
        },
        lock: { mode: 'pessimistic_write' },
      });
      for (const withdrawal of pendingWithdrawals) {
        await this.ledger.unfreeze(tx, {
          userId: order.merchantUserId,
          amountMicro: withdrawal.amountMicro,
          kind: 'withdrawal_reject',
          ref: { type: 'withdrawal', id: withdrawal.id },
        });
        withdrawal.status = 'rejected';
        withdrawal.rejectReason = '商家违规处罚，提现取消';
        withdrawal.reviewedBy = adminId;
        withdrawal.reviewedAt = new Date();
        await tx.getRepository(Withdrawal).save(withdrawal);
      }

      const merchantForfeited = await this.ledger.forfeitAll(tx, {
        userId: order.merchantUserId,
        ref: orderRef,
      });
      await tx
        .getRepository(User)
        .update({ id: order.merchantUserId }, { status: 'suspended' });

      // 该单名额上未执行的核验/放款任务一并撤销（状态复核之外的第二道防线）。
      if (slotRows.length > 0) {
        await tx.getRepository(VerificationJob).delete({
          refId: In(slotRows.map((slot) => slot.id)),
          status: In(['pending']),
        });
      }

      await this.notifications.notify(tx, {
        userId: order.merchantUserId,
        kind: NOTIFY_PENALTY_MERCHANT,
        title: '商单违规处罚',
        body: `「${order.title}」因${reason}被平台关闭，账户已暂停，余额已全额没收。`,
        ref: { type: 'order', id: order.id },
      });

      await this.audit(tx, {
        adminUserId: adminId,
        action: 'order_penalize',
        targetType: 'order',
        targetId: order.id,
        detail: {
          reason,
          escrowForfeitedMicro: String(escrowForfeited),
          merchantForfeitedMicro: String(merchantForfeited),
          compensated: compensated.map((item) => ({
            slotId: item.slotId,
            userId: item.userId,
            amountMicro: String(item.amountMicro),
          })),
          expiredSlotIds: undeliveredSlots.map((slot) => slot.id),
          cancelledWithdrawalIds: pendingWithdrawals.map((row) => row.id),
        },
      });

      return {
        id: order.id,
        status: 'closed',
        escrowForfeitedXm: formatXm(escrowForfeited),
        merchantForfeitedXm: formatXm(merchantForfeited),
        compensated: compensated.map((item) => ({
          slotId: item.slotId,
          userId: item.userId,
          amountXm: formatXm(item.amountMicro),
        })),
        expiredSlotIds: undeliveredSlots.map((slot) => slot.id),
        suspendedUserId: order.merchantUserId,
      };
    });
  }

  // ---------------------------------------------------------------------
  // 用户管理
  // ---------------------------------------------------------------------

  async listUsers(q?: string) {
    const term = q?.trim();
    const qb = this.users.createQueryBuilder('u');

    if (term) {
      const like = `%${term}%`;
      const bindingRows: Array<{ userId: string }> = await this.xBindings
        .createQueryBuilder('x')
        .select('x."user_id"', 'userId')
        .where('x.handle ILIKE :like', { like })
        .getRawMany();
      const bindingUserIds = uniqueIds(bindingRows.map((row) => row.userId));

      qb.where(
        new Brackets((w) => {
          w.where('u.address ILIKE :like', { like })
            .orWhere('u.nickname ILIKE :like', { like })
            .orWhere('u.status ILIKE :like', { like });
          if (bindingUserIds.length) {
            w.orWhere('u.id IN (:...bindingUserIds)', { bindingUserIds });
          }
        }),
      );
    }

    const [rows, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .take(ADMIN_LIST_LIMIT)
      .getManyAndCount();

    const bindings = rows.length
      ? await this.xBindings.findBy({
          userId: In(uniqueIds(rows.map((row) => row.id))),
        })
      : [];
    const handleByUser = new Map(bindings.map((row) => [row.userId, row.handle]));

    return {
      items: rows.map((user) => ({
        id: user.id,
        address: user.address,
        nickname: user.nickname,
        status: user.status,
        role: user.role,
        violations: user.violations,
        ratingGrade: user.ratingGrade,
        xHandle: handleByUser.get(user.id) ?? null,
        createdAt: user.createdAt,
      })),
      total,
    };
  }

  async suspendUser(id: string, adminId: string) {
    return this.setUserStatus(id, true, adminId);
  }

  async unsuspendUser(id: string, adminId: string) {
    return this.setUserStatus(id, false, adminId);
  }

  private async setUserStatus(id: string, suspended: boolean, adminId: string) {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(User);
      const user = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new NotFoundException('用户不存在');
      }
      if (suspended && user.role === 'admin') {
        throw new BadRequestException('不能封禁管理员账号');
      }

      const prevStatus = user.status;
      user.status = suspended ? 'suspended' : 'active';
      await repo.save(user);

      await this.audit(tx, {
        adminUserId: adminId,
        action: suspended ? 'user_suspend' : 'user_unsuspend',
        targetType: 'user',
        targetId: id,
        detail: { prevStatus, status: user.status },
      });

      return {
        id: user.id,
        address: user.address,
        nickname: user.nickname,
        role: user.role,
        status: user.status,
      };
    });
  }

  // ---------------------------------------------------------------------
  // 改绑审核
  // ---------------------------------------------------------------------

  async listBindingChanges(status?: 'pending' | 'approved' | 'rejected') {
    const rows = await this.bindingChanges.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      take: ADMIN_LIST_LIMIT,
    });
    if (rows.length === 0) return [];

    const users = await this.users.findBy({
      id: In(uniqueIds(rows.map((row) => row.userId))),
    });
    const userById = new Map(users.map((user) => [user.id, user]));
    return rows.map((change) => this.bindingChangeView(change, userById.get(change.userId)));
  }

  async approveBindingChange(id: string, adminId: string) {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(BindingChange);
      const change = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!change) {
        throw new NotFoundException('改绑申请不存在');
      }
      if (change.status !== 'pending') {
        throw new BadRequestException('只有待处理的改绑申请可以审核通过');
      }

      change.status = 'approved';
      const saved = await repo.save(change);
      await this.audit(tx, {
        adminUserId: adminId,
        action: 'binding_change_approve',
        targetType: 'binding_change',
        targetId: id,
        detail: {
          userId: saved.userId,
          kind: saved.kind,
          newValue: saved.newValue,
          effectiveAt: saved.effectiveAt.toISOString(),
        },
      });
      const user = await tx.getRepository(User).findOne({ where: { id: saved.userId } });
      return this.bindingChangeView(saved, user ?? undefined);
    });
  }

  async rejectBindingChange(id: string, reason: string, adminId: string) {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(BindingChange);
      const change = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!change) {
        throw new NotFoundException('改绑申请不存在');
      }
      if (change.appliedAt) {
        throw new BadRequestException('该改绑申请已生效，不能驳回');
      }
      if (change.status === 'rejected') {
        throw new BadRequestException('该改绑申请已驳回');
      }

      change.status = 'rejected';
      const saved = await repo.save(change);
      await this.audit(tx, {
        adminUserId: adminId,
        action: 'binding_change_reject',
        targetType: 'binding_change',
        targetId: id,
        detail: {
          userId: saved.userId,
          kind: saved.kind,
          newValue: saved.newValue,
          reason,
        },
      });
      const user = await tx.getRepository(User).findOne({ where: { id: saved.userId } });
      return this.bindingChangeView(saved, user ?? undefined);
    });
  }

  // ---------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------

  private async audit(
    manager: EntityManager | null,
    input: {
      adminUserId: string;
      action: string;
      targetType: string;
      targetId: string;
      detail?: Record<string, any>;
    },
  ): Promise<void> {
    const repo = manager ? manager.getRepository(AdminAction) : this.actions;
    await repo.save(
      repo.create({
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: input.detail ?? {},
      }),
    );
  }

  /**
   * 先写「意向」审计行并提交，再调用自带事务的服务（T8/T9/T13/T15）。
   * 即使后续审计更新失败，操作前已存在 intent=true 的行，不会出现
   * 「钱/状态已动但没有任何审计记录」的空洞；对账可据此发现待确认操作。
   */
  private async startIntentAudit(input: {
    adminUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    detail?: Record<string, any>;
  }): Promise<string> {
    const saved = await this.actions.save(
      this.actions.create({
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: { intent: true, ...(input.detail ?? {}) },
      }),
    );
    return saved.id;
  }

  /** 成功后把同一行改为 intent=false + 结果摘要（更新失败仅告警，不回滚已完成的业务动作）。 */
  private async finishIntentAudit(
    id: string,
    detail: Record<string, any>,
  ): Promise<void> {
    try {
      // 直接写 jsonb：TypeORM 的 QueryDeepPartialEntity 对 jsonb 列类型过窄。
      await this.actions.query(
        `UPDATE "admin_actions" SET "detail" = $1::jsonb WHERE "id" = $2`,
        [JSON.stringify({ intent: false, ...detail }), id],
      );
    } catch (err) {
      this.logger.warn(
        `admin_actions ${id} 结果回写失败（意向行保留）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** 服务失败：意向行保留 intent=true 并记录失败原因（更新失败也无妨）。 */
  private async failIntentAudit(
    id: string,
    detail: Record<string, any>,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await this.actions.query(
        `UPDATE "admin_actions" SET "detail" = $1::jsonb WHERE "id" = $2`,
        [JSON.stringify({ intent: true, ...detail, error: message }), id],
      );
    } catch (err) {
      this.logger.warn(
        `admin_actions ${id} 失败原因回写失败：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async slotAdminViews(rows: OrderSlot[]) {
    if (rows.length === 0) return [];
    const orderIds = uniqueIds(rows.map((row) => row.orderId));
    const creatorIds = uniqueIds(rows.map((row) => row.creatorUserId));
    const [orders, creators] = await Promise.all([
      this.orders.findBy({ id: In(orderIds) }),
      this.users.findBy({ id: In(creatorIds) }),
    ]);
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const creatorById = new Map(creators.map((user) => [user.id, user]));

    return rows.map((slot) => {
      const order = orderById.get(slot.orderId);
      const creator = creatorById.get(slot.creatorUserId);
      return {
        id: slot.id,
        orderId: slot.orderId,
        creatorUserId: slot.creatorUserId,
        status: slot.status,
        acceptedAt: slot.acceptedAt,
        deliverDeadlineAt: slot.deliverDeadlineAt,
        deliveredAt: slot.deliveredAt,
        deliveryUrl: slot.deliveryUrl,
        deliveryTweetId: slot.deliveryTweetId,
        lastReject: slot.lastReject,
        verifySnapshot: slot.verifySnapshot,
        manualReasons: slot.manualReasons ?? [],
        appealRequested: slot.appealRequested,
        confirmedDeadlineAt: slot.confirmedDeadlineAt,
        settledAt: slot.settledAt,
        survivalOverride: slot.survivalOverride,
        createdAt: slot.createdAt,
        order: order
          ? {
              id: order.id,
              title: order.title,
              type: order.type,
              status: order.status,
              merchantUserId: order.merchantUserId,
            }
          : null,
        creator: creator
          ? {
              id: creator.id,
              address: creator.address,
              nickname: creator.nickname,
              status: creator.status,
            }
          : null,
      };
    });
  }

  private toOrderSummary(order: Order) {
    return {
      id: order.id,
      type: order.type,
      title: order.title,
      priceXm: formatXm(order.priceMicro),
      feeXm: formatXm(order.feeMicro),
      escrowXm: formatXm(order.escrowMicro),
      slotsTotal: order.slotsTotal,
      status: order.status,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
      closedAt: order.closedAt,
    };
  }

  private merchantView(user: User | undefined | null) {
    return user
      ? {
          id: user.id,
          address: user.address,
          nickname: user.nickname,
          status: user.status,
        }
      : null;
  }

  private bindingChangeView(change: BindingChange, user?: User) {
    return {
      id: change.id,
      userId: change.userId,
      kind: change.kind,
      newValue: change.newValue,
      status: change.status,
      effectiveAt: change.effectiveAt,
      appliedAt: change.appliedAt,
      createdAt: change.createdAt,
      user: user
        ? { id: user.id, address: user.address, nickname: user.nickname }
        : null,
    };
  }

  private toDepositView(deposit: Deposit): DepositView {
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
