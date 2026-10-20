/** OG 图共享常量与小工具。 */

import { SITE_URL } from './site';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 路由参数校验：非法 UUID 直接 400，不触发后端请求。 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** 截断长标题，避免 OG 图排版溢出。 */
export function truncate(value: string, max: number): string {
  const text = (value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** OG 图底部展示的站点域名。 */
export function siteHost(): string {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return SITE_URL;
  }
}

/** 纯文本响应（400/404 等），避免 OG 路由抛未捕获异常。 */
export function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
