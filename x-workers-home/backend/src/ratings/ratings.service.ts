import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { User } from '../users/user.entity';
import { XScraperService } from '../xscraper/xscraper.service';
import { computeRating } from './rating';
import { UserRating } from './user-rating.entity';

/** 评级取最近 20 条推文（与钉死用例一致） */
export const RATING_TWEET_LIMIT = 20;
/** 周刷新顺序执行，单条之间间隔 500ms，避免打爆 x.py 上游 */
export const RATING_REFRESH_INTERVAL_MS = 500;

export interface PublicRating {
  handle: string;
  score: number;
  grade: string;
  flags: string[];
  breakdown: Record<string, number>;
  computed_at: Date;
}

export interface RatingRefreshStats {
  refreshed: number;
  failed: number;
}

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    @InjectRepository(UserRating)
    private readonly ratings: Repository<UserRating>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(XBinding)
    private readonly bindings: Repository<XBinding>,
    private readonly dataSource: DataSource,
    private readonly scraper: XScraperService,
  ) {}

  /**
   * 拉取 X 资料 + 最近推文 → computeRating → upsert user_ratings，
   * 同事务同步 users.rating_grade（冗余展示列）。
   */
  async computeForUser(userId: string): Promise<PublicRating> {
    const binding = await this.bindings.findOne({ where: { userId } });
    if (!binding || binding.status !== 'active') {
      throw new Error(`用户 ${userId} 未完成 X 绑定，无法评级`);
    }

    const handle = binding.handle;
    const profile = await this.scraper.getProfile(handle);
    const tweets = await this.scraper.getRecentTweets(handle, RATING_TWEET_LIMIT);

    const result = computeRating({
      followers: profile?.followers ?? null,
      following: profile?.following ?? null,
      joinedISO: profile?.joined ?? null,
      tweets: (tweets ?? []).map((tweet) => ({
        views: tweet.views,
        likes: tweet.likes,
        reposts: tweet.reposts,
        replies: tweet.replies,
        bookmarks: tweet.bookmarks,
      })),
    });

    const computedAt = new Date();
    await this.dataSource.transaction(async (tx) => {
      await tx.getRepository(UserRating).upsert(
        {
          userId,
          score: result.score,
          grade: result.grade,
          flags: result.flags,
          breakdown: result.breakdown,
          computedAt,
        },
        ['userId'],
      );
      await tx.getRepository(User).update({ id: userId }, { ratingGrade: result.grade });
    });

    return { handle, ...result, computed_at: computedAt };
  }

  /** 公开查询：仅返回已激活绑定且已评级过的账号 */
  async getByHandle(rawHandle: string): Promise<PublicRating | null> {
    const handle = normalizeHandle(rawHandle);
    const binding = await this.bindings.findOne({ where: { handle, status: 'active' } });
    if (!binding) return null;

    const rating = await this.ratings.findOne({ where: { userId: binding.userId } });
    if (!rating) return null;

    return {
      handle: binding.handle,
      score: rating.score,
      grade: rating.grade,
      flags: rating.flags,
      breakdown: rating.breakdown,
      computed_at: rating.computedAt,
    };
  }

  /** 批量刷新所有 active 用户：顺序执行，单条失败跳过继续 */
  async refreshAll(): Promise<RatingRefreshStats> {
    const rows = await this.users
      .createQueryBuilder('u')
      .innerJoin(XBinding, 'b', 'b.user_id = u.id')
      .where('u.status = :status', { status: 'active' })
      .andWhere('b.status = :bindingStatus', { bindingStatus: 'active' })
      .select('u.id', 'id')
      .getRawMany<{ id: string }>();

    let refreshed = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const { id } = rows[i];
      try {
        await this.computeForUser(id);
        refreshed += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(`评级刷新失败 userId=${id}：${errorMessage(err)}`);
      }
      if (i < rows.length - 1) {
        await sleep(RATING_REFRESH_INTERVAL_MS);
      }
    }

    this.logger.log(`评级批量刷新完成：成功 ${refreshed}，失败 ${failed}`);
    return { refreshed, failed };
  }

  /**
   * 每周一 03:00 UTC 批量刷新（timeZone 显式指定，不随服务器本地时区漂移）。
   * e2e 里直接调用 refreshAll()，避免测试期间后台任务干扰。
   */
  @Cron('0 3 * * 1', { timeZone: 'UTC' })
  async weeklyRefresh(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.refreshAll();
  }
}
