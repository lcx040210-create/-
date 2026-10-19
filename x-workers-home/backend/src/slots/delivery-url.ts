import { BadRequestException } from '@nestjs/common';

/** x.com / twitter.com 及其 www/mobile/m 变体。 */
const TWEET_HOST_PATTERN = /^(?:www\.|mobile\.|m\.)?(?:x|twitter)\.com$/;

/**
 * /<handle>/status/<digits>，允许尾斜杠；查询串与锚点在解析时已丢弃。
 * 真实 X handle 只含字母数字下划线，这里放宽连字符以兼容历史/测试链接，
 * 但路径结构仍必须是 status 链接。
 */
const STATUS_PATH_PATTERN = /^\/([A-Za-z0-9_-]{1,15})\/status\/(\d+)\/?$/i;

/** /i/web/status/<digits>（无需登录的推文直链形式）。 */
const I_WEB_STATUS_PATH_PATTERN = /^\/i\/web\/status\/(\d+)\/?$/i;

/**
 * 交付链接规范化（纯函数）：
 * - 仅接受 http(s) 的 x.com / twitter.com（含 www/mobile/m 子域）；
 * - 路径必须是 /<handle>/status/<digits> 或 /i/web/status/<digits>；
 * - 统一输出 `https://x.com/<小写 handle>/status/<id>`（i/web 形式保持原路径），
 *   查询串、锚点、尾斜杠全部丢弃，保证同一推文的变体落同一字符串。
 * - 非 X 域 / 非状态链接 → 400（交付必须是推文链接）。
 */
export function canonicalizeDeliveryUrl(raw: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    throw new BadRequestException('交付链接不合法');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('交付链接不合法');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('交付链接必须使用 http(s) 协议');
  }
  if (parsed.port) {
    throw new BadRequestException('交付链接不合法');
  }

  const host = parsed.hostname.toLowerCase();
  if (!TWEET_HOST_PATTERN.test(host)) {
    throw new BadRequestException('交付链接必须是 X 推文链接');
  }

  const iWeb = I_WEB_STATUS_PATH_PATTERN.exec(parsed.pathname);
  if (iWeb) {
    return `https://x.com/i/web/status/${iWeb[1]}`;
  }

  const status = STATUS_PATH_PATTERN.exec(parsed.pathname);
  if (!status) {
    throw new BadRequestException('交付链接必须是 X 推文链接');
  }

  const handle = status[1].toLowerCase();
  // /i/* 是 X 的内部路由，唯一可接受的 i 形式是 /i/web/status/<id>（上面已处理）。
  if (handle === 'i') {
    throw new BadRequestException('交付链接必须是 X 推文链接');
  }

  return `https://x.com/${handle}/status/${status[2]}`;
}

/** 规范化 URL 末尾的推文状态 id（handle 与 /i/web/ 两种形式都适用）。 */
const CANONICAL_TWEET_ID_PATTERN = /\/status\/(\d+)$/;

/**
 * 从规范化后的交付 URL 提取推文 id，用于推文级去重：
 * 同一推文可能以 `/<handle>/status/<id>` 与 `/i/web/status/<id>` 两种字符串形式出现，
 * URL 唯一索引无法拦截，必须按 id 再建部分唯一索引。
 */
export function extractDeliveryTweetId(canonicalUrl: string): string | null {
  const match = CANONICAL_TWEET_ID_PATTERN.exec((canonicalUrl ?? '').trim());
  return match ? match[1] : null;
}
