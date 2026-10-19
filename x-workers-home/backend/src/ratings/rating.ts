/**
 * 账户评级 v1（纯函数，无 IO）。
 *
 * 权重刻意写死为常量，后续调参只改这里；测试会钉死公式行为。
 * 数据缺失策略（x.py 上游 clean() 会丢掉 None 字段，字段可能根本不存在）：
 *  - tweets 里全部缺 views → avg_views 与 engagement 两个分量剔除；
 *  - joinedISO 缺失/不可解析 → age 分量剔除；
 *  - 剔除后剩余权重重新归一。
 */

export type RatingGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface RatingTweetInput {
  views?: number | null;
  likes?: number | null;
  reposts?: number | null;
  replies?: number | null;
  bookmarks?: number | null;
}

export interface RatingInput {
  followers?: number | null;
  following?: number | null;
  /** X 账号注册时间（ISO 字符串）；缺失则 age 分量剔除 */
  joinedISO?: string | null;
  tweets: RatingTweetInput[];
}

export interface RatingResult {
  score: number;
  grade: RatingGrade;
  flags: string[];
  /** 各存在分量的 0..1 归一值（不含权重），键：followers/avg_views/engagement/age/ratio */
  breakdown: Record<string, number>;
}

export const RATING_WEIGHTS = {
  followers: 0.3,
  avg_views: 0.25,
  engagement: 0.25,
  age: 0.1,
  ratio: 0.1,
} as const;

/** 刷粉判定阈值：粉丝 ≥ 1000 且平均互动率 < 0.2% */
export const BRUSH_MIN_FOLLOWERS = 1000;
export const BRUSH_MAX_RATE = 0.002;
/** 5 年（1825 天）封顶的账号年龄 */
export const AGE_FULL_DAYS = 1825;
const ENGAGEMENT_FULL_RATE = 0.05;
const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 缺失/非法数值按 0 计（互动数字段缺失很常见） */
function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number | null | undefined): number {
  return Math.max(0, num(value));
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, (now.getTime() - ms) / DAY_MS);
}

function gradeForScore(score: number): RatingGrade {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * @param input 账号资料 + 最近推文（字段可缺）
 * @param now 仅用于测试注入固定时间；默认当前时间
 */
export function computeRating(input: RatingInput, now: Date = new Date()): RatingResult {
  const followers = nonNegative(input.followers);
  const following = nonNegative(input.following);
  const tweets = input.tweets ?? [];

  // x.py 的 views 缺失是字段不存在（undefined），也可能是 null：统一用 == null。
  const tweetsWithViews = tweets.filter(
    (tweet) => tweet.views != null && Number.isFinite(tweet.views) && tweet.views >= 0,
  );

  let avgViewsComponent: number | null = null;
  let engagementComponent: number | null = null;
  /** 平均互动率，仅用于刷粉判定（用于封顶 grade，不影响 score） */
  let engagementRate: number | null = null;

  if (tweetsWithViews.length > 0) {
    const totalViews = tweetsWithViews.reduce((sum, tweet) => sum + (tweet.views as number), 0);
    const avgViews = totalViews / tweetsWithViews.length;
    avgViewsComponent = clamp01(Math.log10(avgViews + 1) / 5.5);

    const rates = tweetsWithViews.map((tweet) => {
      const interactions =
        num(tweet.likes) + num(tweet.reposts) + num(tweet.replies) + num(tweet.bookmarks);
      return interactions / Math.max(tweet.views as number, 1);
    });
    engagementRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    engagementComponent = clamp01(engagementRate / ENGAGEMENT_FULL_RATE);
  }

  const ageDays = daysSince(input.joinedISO, now);

  const components: Array<{ key: keyof typeof RATING_WEIGHTS; value: number }> = [
    { key: 'followers', value: clamp01(Math.log10(followers + 1) / 6) },
  ];
  if (avgViewsComponent !== null) components.push({ key: 'avg_views', value: avgViewsComponent });
  if (engagementComponent !== null) {
    components.push({ key: 'engagement', value: engagementComponent });
  }
  if (ageDays !== null) components.push({ key: 'age', value: clamp01(ageDays / AGE_FULL_DAYS) });
  components.push({ key: 'ratio', value: clamp01(1 - following / (followers + 1)) });

  // 缺失分量剔除后按剩余权重重新归一
  let weightedSum = 0;
  let weightSum = 0;
  const breakdown: Record<string, number> = {};
  for (const component of components) {
    const weight = RATING_WEIGHTS[component.key];
    weightedSum += component.value * weight;
    weightSum += weight;
    breakdown[component.key] = round4(component.value);
  }

  const score = Math.round((weightSum > 0 ? weightedSum / weightSum : 0) * 100);

  const flags: string[] = [];
  if (
    followers >= BRUSH_MIN_FOLLOWERS &&
    engagementRate !== null &&
    engagementRate < BRUSH_MAX_RATE
  ) {
    flags.push('brush');
  }

  const grade = gradeForScore(score);
  // 刷粉旗标只封顶 grade，不篡改 score；C 及以下保持原等级
  const finalGrade: RatingGrade = flags.includes('brush') && (grade === 'S' || grade === 'A' || grade === 'B')
    ? 'C'
    : grade;

  return { score, grade: finalGrade, flags, breakdown };
}
