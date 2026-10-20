/**
 * 邀请档位展示（与后端 ReferralService.tierOf 同口径）：
 * 0-4 人 → 20%，5-9 人 → 30%，≥10 人 → 40%。
 */

export const TIER_THRESHOLDS = {
  first: 5,
  second: 10,
} as const;

export interface TierProgress {
  /** 当前返佣档位（百分数）。 */
  tier: number;
  /** 下一档位；已达最高档为 null。 */
  nextTier: number | null;
  /** 距下一档还差的人数；已达最高档为 0。 */
  remaining: number;
  /** 直接可展示的进度文案。 */
  text: string;
  /** 距下一档的进度百分比（0-100）；已达最高档为 100。 */
  percent: number;
}

export function tierProgress(inviteesCount: number): TierProgress {
  const count =
    Number.isFinite(inviteesCount) && inviteesCount > 0 ? Math.floor(inviteesCount) : 0;

  if (count >= TIER_THRESHOLDS.second) {
    return {
      tier: 40,
      nextTier: null,
      remaining: 0,
      text: '已达最高档位（40%）',
      percent: 100,
    };
  }

  if (count >= TIER_THRESHOLDS.first) {
    const remaining = TIER_THRESHOLDS.second - count;
    return {
      tier: 30,
      nextTier: 40,
      remaining,
      text: `距下一档还差 ${remaining} 人（40%）`,
      percent: Math.round((count / TIER_THRESHOLDS.second) * 100),
    };
  }

  const remaining = TIER_THRESHOLDS.first - count;
  return {
    tier: 20,
    nextTier: 30,
    remaining,
    text: `距下一档还差 ${remaining} 人（30%）`,
    percent: Math.round((count / TIER_THRESHOLDS.first) * 100),
  };
}
