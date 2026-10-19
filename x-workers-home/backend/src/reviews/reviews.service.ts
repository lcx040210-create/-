import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/order.entity';
import { OrderSlot } from '../slots/order-slot.entity';
import { User } from '../users/user.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { Review } from './review.entity';

/** 公开主页「近期评价」最多返回条数。 */
export const RECENT_REVIEWS_LIMIT = 10;

export interface RecentReviewView {
  id: string;
  score: number;
  comment: string | null;
  createdAt: Date;
  from: { id: string; nickname: string | null };
}

export interface UserRatingSummary {
  /** AVG(score) 实时计算，保留 1 位小数；无评价为 null。 */
  average: number | null;
  count: number;
  recent: RecentReviewView[];
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; driverError?: { code?: string } } | null;
  return candidate?.code === '23505' || candidate?.driverError?.code === '23505';
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviews: Repository<Review>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 双向互评：仅 paid 名额、仅交易双方、每侧一次。
   * 事务内锁名额行串行化重复提交，唯一索引 (slot_id, from_user_id) 兜底并发。
   */
  async create(slotId: string, fromUserId: string, dto: CreateReviewDto): Promise<Review> {
    try {
      return await this.dataSource.transaction(async (tx) => {
        const slot = await tx.getRepository(OrderSlot).findOne({
          where: { id: slotId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!slot) {
          throw new NotFoundException('名额不存在');
        }
        if (slot.status !== 'paid') {
          throw new BadRequestException('该名额尚未放款，暂不可评价');
        }

        const order = await tx.getRepository(Order).findOne({ where: { id: slot.orderId } });
        if (!order) {
          throw new NotFoundException('商单不存在');
        }

        // 商家评接单方，接单方评商家；第三人一律 403。
        let toUserId: string;
        if (fromUserId === order.merchantUserId) {
          toUserId = slot.creatorUserId;
        } else if (fromUserId === slot.creatorUserId) {
          toUserId = order.merchantUserId;
        } else {
          throw new ForbiddenException('只有交易双方可以评价');
        }

        const repo = tx.getRepository(Review);
        const comment = dto.comment?.trim() || null;
        const review = await repo.save(
          repo.create({
            slotId,
            orderId: slot.orderId,
            fromUserId,
            toUserId,
            score: dto.score,
            comment,
          }),
        );

        await this.notifications.notify(tx, {
          userId: toUserId,
          kind: 'review_received',
          title: '收到新评价',
          body: `对方给你打了 ${dto.score} 星${comment ? `：${comment}` : ''}`,
          ref: { type: 'slot', id: slotId },
        });

        return review;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('你已评价过该名额');
      }
      throw err;
    }
  }

  /** 公开查询：实时 AVG + 总数 + 最近 10 条（倒序）。 */
  async getUserRating(userId: string): Promise<UserRatingSummary> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const [averageRaw, count] = await Promise.all([
      this.reviews.average('score', { toUserId: userId }),
      this.reviews.count({ where: { toUserId: userId } }),
    ]);
    const average = count > 0 && averageRaw !== null ? Math.round(averageRaw * 10) / 10 : null;

    const rows = await this.reviews.find({
      where: { toUserId: userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: RECENT_REVIEWS_LIMIT,
    });

    const fromIds = [...new Set(rows.map((row) => row.fromUserId))];
    const fromUsers = fromIds.length
      ? await this.users.find({
          where: { id: In(fromIds) },
          select: { id: true, nickname: true },
        })
      : [];
    const nicknames = new Map(fromUsers.map((from) => [from.id, from.nickname]));

    return {
      average,
      count,
      recent: rows.map((row) => ({
        id: row.id,
        score: row.score,
        comment: row.comment,
        createdAt: row.createdAt,
        from: {
          id: row.fromUserId,
          nickname: nicknames.get(row.fromUserId) ?? null,
        },
      })),
    };
  }
}
