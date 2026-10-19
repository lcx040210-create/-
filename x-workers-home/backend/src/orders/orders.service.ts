import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { MICRO, formatXm, parseXm, pctFloor } from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import {
  ESCROW_HELD_SLOT_STATUSES,
  OrderSlot,
  OrderSlotStatus,
} from '../slots/order-slot.entity';
import { User } from '../users/user.entity';
import { CreateOrderDto, OrderRequirementsDto } from './dto/create-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { Order, OrderRequirements, OrderStatus, OrderType } from './order.entity';

export const ORDER_PAGE_SIZE = 20;
export const ORDER_FEE_NUM = 5;
export const ORDER_FEE_DEN = 100;
export const DEFAULT_EXPIRES_IN_DAYS = 7;

/** x.com / twitter.com 推文链接（手机版与旧版 /statuses/ 兼容）。 */
const TARGET_TWEET_URL_PATTERN =
  /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status(?:es)?\/\d+/i;

export interface OrderView {
  id: string;
  type: OrderType;
  title: string;
  brief: string;
  requirements: OrderRequirements;
  targetTweetUrl: string | null;
  priceXm: string;
  /** 接单方到手 = P − pctFloor(P, 5, 100)。 */
  payoutXm: string;
  slotsTotal: number;
  /** 自由池 = slots_total − 非 expired 名额数（T12）。 */
  slotsAvailable: number;
  merchantRatingGrade: string | null;
  status: OrderStatus;
  expiresAt: Date;
  createdAt: Date;
  closedAt: Date | null;
}

/** 公开名额视图：1.0 脱敏——不暴露 delivery_url / verify_snapshot / last_reject。 */
export interface OrderSlotPublicView {
  id: string;
  status: OrderSlotStatus;
  acceptedAt: Date;
  deliverDeadlineAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
  creator: { nickname: string | null; ratingGrade: string | null };
}

export interface OrderDetailView extends OrderView {
  slots: OrderSlotPublicView[];
}

export interface OrderListResult {
  items: OrderView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * 建单：active + X 绑定 active；冻结 P×N + fee（fee 随托管冻结，
   * 首次被抢单才转 income——保证从未被接时下架可全额退）。
   */
  async create(userId: string, dto: CreateOrderDto): Promise<OrderView> {
    const priceMicro = this.parsePrice(dto.priceXm);
    const targetTweetUrl = this.parseTargetTweetUrl(dto);
    const slots = dto.slots;
    const total = priceMicro * BigInt(slots);
    const feeMicro = pctFloor(total, ORDER_FEE_NUM, ORDER_FEE_DEN);
    const expiresInDays = dto.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const created = await this.dataSource.transaction(async (tx) => {
      await this.assertPublishable(tx, userId);

      // 先冻结再建单：余额不足时事务回滚，不留下任何订单行。
      await this.ledger.transfer(tx, {
        from: { userId },
        to: { platform: 'escrow' },
        amountMicro: total + feeMicro,
        kind: 'order_freeze',
        ref: { type: 'user', id: userId },
      });

      const repo = tx.getRepository(Order);
      return repo.save(
        repo.create({
          merchantUserId: userId,
          type: dto.type,
          title: dto.title,
          brief: dto.brief,
          requirements: this.normalizeRequirements(dto.requirements),
          targetTweetUrl,
          priceMicro,
          slotsTotal: slots,
          feeMicro,
          feeEarned: false,
          escrowMicro: total + feeMicro,
          status: 'recruiting',
          expiresAt,
          minRatingGrade: null,
          closedAt: null,
        }),
      );
    });

    return this.toView(created, await this.userGrade(userId), false, 0);
  }

  /** 公开列表：默认 recruiting，最新在前；可按类型筛选、单价降序、分页。 */
  async list(query: ListOrdersDto): Promise<OrderListResult> {
    const page = query.page ?? 1;
    const qb = this.orders
      .createQueryBuilder('o')
      .where('o.status = :status', { status: 'recruiting' });

    if (query.type) {
      qb.andWhere('o.type = :type', { type: query.type });
    }
    if (query.sort === 'price') {
      qb.orderBy('o.priceMicro', 'DESC');
    } else {
      qb.orderBy('o.createdAt', 'DESC');
    }
    qb.addOrderBy('o.id', 'DESC').skip((page - 1) * ORDER_PAGE_SIZE).take(ORDER_PAGE_SIZE);

    const [rows, total] = await qb.getManyAndCount();
    const grades = await this.gradesFor(rows.map((row) => row.merchantUserId));
    const takenCounts = await this.takenCounts(rows.map((row) => row.id));

    return {
      items: rows.map((row) =>
        this.toView(
          row,
          grades.get(row.merchantUserId) ?? null,
          true,
          takenCounts.get(row.id) ?? 0,
        ),
      ),
      total,
      page,
      pageSize: ORDER_PAGE_SIZE,
    };
  }

  /** 公开详情；closed / completed 均可查看，附公开名额列表（脱敏）。 */
  async detail(id: string): Promise<OrderDetailView> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException('商单不存在');
    }

    const slotRows = await this.orders.manager.getRepository(OrderSlot).find({
      where: { orderId: id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const creatorIds = Array.from(new Set(slotRows.map((slot) => slot.creatorUserId)));
    const creators = creatorIds.length
      ? await this.users.findBy({ id: In(creatorIds) })
      : [];
    const creatorById = new Map(creators.map((user) => [user.id, user]));
    const takenCount = slotRows.filter((slot) => slot.status !== 'expired').length;

    return {
      ...this.toView(
        order,
        await this.userGrade(order.merchantUserId),
        false,
        takenCount,
      ),
      slots: slotRows.map((slot) => {
        const creator = creatorById.get(slot.creatorUserId);
        // 1.0 公开字段脱敏：只给状态、时间与创作者展示信息，不含交付链接。
        return {
          id: slot.id,
          status: slot.status,
          acceptedAt: slot.acceptedAt,
          deliverDeadlineAt: slot.deliverDeadlineAt,
          deliveredAt: slot.deliveredAt,
          createdAt: slot.createdAt,
          creator: {
            nickname: creator?.nickname ?? null,
            ratingGrade: creator?.ratingGrade ?? null,
          },
        };
      }),
    };
  }

  /**
   * 下架（商家）：recruiting → closed。
   * 只退自由池（slots_total − 非 expired 名额）；活跃名额继续走完，P 留在 escrow。
   * fee 未赚（从未被抢）时活跃名额必为 0，退款自然含 fee，即全额。
   */
  async close(userId: string, id: string): Promise<OrderView> {
    const { order, taken } = await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Order);
      const order = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException('商单不存在');
      }
      if (order.merchantUserId !== userId) {
        throw new ForbiddenException('只能下架自己的商单');
      }
      if (order.status !== 'recruiting') {
        throw new BadRequestException('只有招募中的商单可以下架');
      }

      const taken = await this.refundFreePoolAndClose(tx, order);
      return { order, taken };
    });

    return this.toView(order, await this.userGrade(userId), false, taken);
  }

  /**
   * 到期关闭（T14 cron 调用）：锁订单行后复核 `recruiting` 且 `expires_at <= now`，
   * 与商家主动下架共用同一退款逻辑。返回是否真正关闭（幂等，重复扫描返回 false）。
   */
  async closeExpired(id: string, now: Date = new Date()): Promise<boolean> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Order);
      const order = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !order ||
        order.status !== 'recruiting' ||
        order.expiresAt.getTime() > now.getTime()
      ) {
        return false;
      }

      await this.refundFreePoolAndClose(tx, order);
      return true;
    });
  }

  /**
   * 关闭退款（close / closeExpired 共用）：只退自由池 + 未赚的 fee。
   * 调用方必须已锁订单行并在同一事务内调用；本方法负责保存订单。
   * 返回成交名额数（非 expired），供视图计算剩余名额。
   */
  private async refundFreePoolAndClose(tx: EntityManager, order: Order): Promise<number> {
    const slotRepo = tx.getRepository(OrderSlot);
    const taken = await slotRepo.count({
      where: { orderId: order.id, status: Not('expired') },
    });
    const held = await slotRepo.count({
      where: { orderId: order.id, status: In([...ESCROW_HELD_SLOT_STATUSES]) },
    });
    const freeSlots = order.slotsTotal - taken;

    // 退款 = 托管 − 活跃名额仍占用的 P；等价于「自由池 × P + 未赚的 fee」。
    const refundMicro = order.escrowMicro - order.priceMicro * BigInt(held);
    const expectedRefund =
      order.priceMicro * BigInt(freeSlots) + (order.feeEarned ? 0n : order.feeMicro);
    // DB 无 CHECK：这里断言订单托管账未被破坏。
    if (
      refundMicro < 0n ||
      refundMicro > order.escrowMicro ||
      refundMicro !== expectedRefund
    ) {
      throw new InternalServerErrorException('托管不变量异常：下架退款额越界');
    }

    if (refundMicro > 0n) {
      await this.ledger.transfer(tx, {
        from: { platform: 'escrow' },
        to: { userId: order.merchantUserId },
        amountMicro: refundMicro,
        kind: 'order_refund',
        ref: { type: 'order', id: order.id },
      });
    }

    order.escrowMicro -= refundMicro;
    order.status = 'closed';
    order.closedAt = new Date();
    await tx.getRepository(Order).save(order);
    return taken;
  }

  /** 批量统计各订单的非 expired 名额数（自由池计算）。 */
  private async takenCounts(orderIds: string[]): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const rows: Array<{ orderId: string; count: number }> =
      await this.orders.manager.query(
        `SELECT "order_id" AS "orderId", COUNT(*)::int AS "count"
           FROM "order_slots"
          WHERE "order_id" = ANY($1::uuid[]) AND "status" <> 'expired'
          GROUP BY "order_id"`,
        [orderIds],
      );
    return new Map(rows.map((row) => [row.orderId, row.count]));
  }

  private async assertPublishable(tx: EntityManager, userId: string): Promise<void> {
    const user = await tx.getRepository(User).findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    if (user.status !== 'active') {
      throw new ForbiddenException('账号状态异常，暂不可发单');
    }
    const binding = await tx.getRepository(XBinding).findOne({ where: { userId } });
    if (!binding || binding.status !== 'active') {
      throw new BadRequestException('请先完成 X 绑定');
    }
  }

  /** priceXm 必须是 ≥1 的整数 XM（不接受小数）。 */
  private parsePrice(priceXm: string): bigint {
    let priceMicro: bigint;
    try {
      priceMicro = parseXm(priceXm);
    } catch {
      throw new BadRequestException('非法价格');
    }
    if (priceMicro < MICRO || priceMicro % MICRO !== 0n) {
      throw new BadRequestException('价格必须为 ≥1 的整数 XM');
    }
    return priceMicro;
  }

  private parseTargetTweetUrl(dto: CreateOrderDto): string | null {
    const url = dto.targetTweetUrl?.trim() || null;
    if (dto.type !== 'post' && !url) {
      throw new BadRequestException('评论/引用类商单必须提供目标推文链接');
    }
    if (url && !TARGET_TWEET_URL_PATTERN.test(url)) {
      throw new BadRequestException('目标推文链接必须是 x.com / twitter.com 链接');
    }
    return url;
  }

  private normalizeRequirements(dto: OrderRequirementsDto): OrderRequirements {
    return {
      keywords: [...dto.keywords],
      hashtags: [...dto.hashtags],
      mentions: [...dto.mentions],
      links: [...dto.links],
      ...(dto.minChars !== undefined ? { minChars: dto.minChars } : {}),
    };
  }

  private async userGrade(userId: string): Promise<string | null> {
    const user = await this.users.findOne({ where: { id: userId } });
    return user?.ratingGrade ?? null;
  }

  private async gradesFor(userIds: string[]): Promise<Map<string, string | null>> {
    const ids = Array.from(new Set(userIds));
    if (!ids.length) return new Map();
    const users = await this.users.findBy({ id: In(ids) });
    return new Map(users.map((user) => [user.id, user.ratingGrade]));
  }

  private toView(
    order: Order,
    merchantRatingGrade: string | null,
    summaryBrief: boolean,
    takenCount: number,
  ): OrderView {
    return {
      id: order.id,
      type: order.type,
      title: order.title,
      brief: summaryBrief ? this.summarize(order.brief) : order.brief,
      requirements: order.requirements,
      targetTweetUrl: order.targetTweetUrl,
      priceXm: formatXm(order.priceMicro),
      payoutXm: formatXm(
        order.priceMicro - pctFloor(order.priceMicro, ORDER_FEE_NUM, ORDER_FEE_DEN),
      ),
      slotsTotal: order.slotsTotal,
      slotsAvailable: order.slotsTotal - takenCount,
      merchantRatingGrade,
      status: order.status,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
      closedAt: order.closedAt,
    };
  }

  private summarize(text: string, max = 120): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
}
