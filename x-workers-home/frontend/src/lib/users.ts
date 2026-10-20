/**
 * 公开主页数据契约（与 backend/src/users、ratings、reviews 对齐）。
 */

import { PublicApiError, getPublicJson } from './public-api';

export interface PublicUser {
  id: string;
  handle: string | null;
  joined: string;
  ratingGrade: string | null;
  completedCount: number;
  xBound: boolean;
}

export interface RecentReview {
  id: string;
  score: number;
  comment: string | null;
  createdAt: string;
  from: { id: string; nickname: string | null };
}

export interface UserRatingSummary {
  /** 1 位小数；无评价为 null。 */
  average: number | null;
  count: number;
  recent: RecentReview[];
}

export interface AccountRating {
  handle: string;
  score: number;
  grade: string;
  flags: string[];
  breakdown: Record<string, number>;
  computed_at: string;
}

/** 评级分量展示顺序与中文名（backend/src/ratings/rating.ts 的 key）。 */
export const RATING_COMPONENT_LABEL: Record<string, string> = {
  followers: '粉丝规模',
  avg_views: '平均阅读',
  engagement: '互动率',
  age: '账号年龄',
  ratio: '关注比',
};

export const RATING_FLAG_LABEL: Record<string, string> = {
  brush: '疑似刷粉',
};

const JOINED_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

/** ISO 时间 → `YYYY年M月D日`（北京时间，避免依赖服务器时区）。 */
export function formatJoined(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return JOINED_FORMATTER.format(date);
}

/** 0..1 归一值 → 百分数文案（1 位小数）。 */
export function formatComponent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(Math.min(1, Math.max(0, value)) * 100).toFixed(1)}%`;
}

export function fetchPublicUser(id: string): Promise<PublicUser> {
  return getPublicJson<PublicUser>(
    `/users/${encodeURIComponent(id)}/public`,
    '用户不存在',
  );
}

export function fetchUserRating(id: string): Promise<UserRatingSummary> {
  return getPublicJson<UserRatingSummary>(
    `/users/${encodeURIComponent(id)}/rating`,
    '用户不存在',
  );
}

/** 按 X handle 查询账户评级；未评级 / 未绑定返回 null。 */
export async function fetchAccountRating(handle: string): Promise<AccountRating | null> {
  try {
    return await getPublicJson<AccountRating>(
      `/ratings/${encodeURIComponent(handle)}`,
      '暂无评级',
    );
  } catch (err) {
    if (err instanceof PublicApiError && err.status === 404) return null;
    throw err;
  }
}
