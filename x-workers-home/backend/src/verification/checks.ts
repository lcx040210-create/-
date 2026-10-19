import { OrderRequirements, OrderType } from '../orders/order.entity';
import { XTweet } from '../xscraper/xscraper.types';

export interface DeliveryExpectation {
  /** 接单方当前绑定的 X handle（可带 @、大小写不敏感）。 */
  handle: string;
  requirements: OrderRequirements;
  type: OrderType;
}

export interface DeliveryCheckResult {
  ok: boolean;
  reasons: string[];
}

/**
 * 类型默认最少字符数：comment / quote 要求 >10 字符（即 ≥11），post 只要求非空。
 * requirements.minChars 可覆盖。
 */
export const DEFAULT_MIN_CHARS: Record<OrderType, number> = {
  post: 1,
  comment: 11,
  quote: 11,
};

function normalizeHandle(raw: string | undefined | null): string {
  return (raw ?? '').trim().replace(/^@/, '').toLowerCase();
}

function textIncludesToken(text: string, token: string): boolean {
  return text.toLowerCase().includes(token.toLowerCase());
}

/** 链接子串匹配口径：大小写不敏感、忽略要求串的尾部斜杠。 */
function textIncludesLink(text: string, token: string): boolean {
  const needle = token.trim().replace(/\/+$/, '').toLowerCase();
  return text.toLowerCase().includes(needle);
}

/**
 * 交付核验（纯函数）。全部要求逐项包含即通过；不通过时返回所有原因。
 * 原因编码：
 * - author_mismatch：作者不是接单方绑定的 handle
 * - too_short：正文长度不足
 * - missing:<token>：缺少关键词 / 话题标签 / @提及
 * - missing_link:<token>：缺少要求链接
 */
export function evaluateDelivery(
  tweet: XTweet,
  exp: DeliveryExpectation,
): DeliveryCheckResult {
  const reasons: string[] = [];
  const text = tweet.text ?? '';
  const requirements = exp.requirements ?? ({} as OrderRequirements);

  // 作者：x.py clean() 会丢 null 字段，author / handle 可能缺失。
  const author = normalizeHandle(tweet.author?.handle);
  if (!author || author !== normalizeHandle(exp.handle)) {
    reasons.push('author_mismatch');
  }

  // 长度：requirements.minChars 覆盖类型默认值。
  const configuredMin = requirements.minChars;
  const minChars =
    typeof configuredMin === 'number' && Number.isFinite(configuredMin)
      ? configuredMin
      : (DEFAULT_MIN_CHARS[exp.type] ?? 1);
  if (text.length < minChars) {
    reasons.push('too_short');
  }

  for (const keyword of requirements.keywords ?? []) {
    if (!textIncludesToken(text, keyword)) {
      reasons.push(`missing:${keyword}`);
    }
  }

  for (const hashtag of requirements.hashtags ?? []) {
    const token = hashtag.startsWith('#') ? hashtag : `#${hashtag}`;
    if (!textIncludesToken(text, token)) {
      reasons.push(`missing:${hashtag}`);
    }
  }

  for (const mention of requirements.mentions ?? []) {
    const token = mention.startsWith('@') ? mention : `@${mention}`;
    if (!textIncludesToken(text, token)) {
      reasons.push(`missing:${mention}`);
    }
  }

  for (const link of requirements.links ?? []) {
    if (!textIncludesLink(text, link)) {
      reasons.push(`missing_link:${link}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
