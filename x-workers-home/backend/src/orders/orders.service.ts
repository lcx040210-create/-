import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { MICRO, formatXm, parseXm, pctFloor } from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
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
  /** T11 尚无 slots 表：= slots_total；T12 改为扣除非 expired 名额。 */
  slotsAvailable: number;
  merchantRatingGrade: string | null;
  status: OrderStatus;
  expiresAt: Date;
  createdAt: Date;
  closedAt: Date | null;
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

    return this.toView(created, await this.userGrade(userId), false);
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

    return {
      items: rows.map((row) =>
        this.toView(row, grades.get(row.merchantUserId) ?? null, true),
      ),
      total,
      page,
      pageSize: ORDER_PAGE_SIZE,
    };
  }

  /** 公开详情；closed / completed 均可查看。 */
  async detail(id: string): Promise<OrderView> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException('商单不存在');
    }
    return this.toView(order, await this.userGrade(order.merchantUserId), false);
  }

  /**
   * 下架（商家）：recruiting → closed。
   * 退自由池 ×P；从未被接（fee_earned=false）连 fee 一起退，即全额。
   * 已接名额继续走完（名额表与后续流程在 T12-T14）。
   */
  async close(userId: string, id: string): Promise<OrderView> {
    const row = await this.dataSource.transaction(async (tx) => {
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

      // T11 尚无名额表：自由池 = slots_total（T12 起扣除未过期名额）。
      const freeSlots = order.slotsTotal;
      const refundMicro =
        order.priceMicro * BigInt(freeSlots) + (order.feeEarned ? 0n : order.feeMicro);

      if (refundMicro > 0n) {
        await this.ledger.transfer(tx, {
          from: { platform: 'escrow' },
          to: { userId },
          amountMicro: refundMicro,
          kind: 'order_refund',
          ref: { type: 'order', id: order.id },
        });
      }

      order.escrowMicro -= refundMicro;
      order.status = 'closed';
      order.closedAt = new Date();
      return repo.save(order);
    });

    return this.toView(row, await this.userGrade(userId), false);
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
      slotsAvailable: order.slotsTotal,
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
