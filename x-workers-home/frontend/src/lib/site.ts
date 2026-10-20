/** 站点绝对地址：分享链接 / og:image 统一走 NEXT_PUBLIC_SITE_URL，去掉尾斜杠避免双斜杠。 */

export const DEFAULT_SITE_URL = 'http://localhost:4000';

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** 空值 / 纯空白 → 回落到本地地址；保证返回值不带尾斜杠。 */
export function resolveSiteUrl(value: string | undefined | null): string {
  const raw = (value ?? '').trim();
  return normalizeBaseUrl(raw || DEFAULT_SITE_URL);
}

export const SITE_URL = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

/** 站内路径 → 绝对地址；入参有无前导斜杠均可。 */
export function absoluteUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${normalized}`;
}

/** 邀请链接：`${SITE_URL}/login?ref=CODE`（code 做 URL 编码）。 */
export function buildInviteUrl(code: string, siteUrl: string = SITE_URL): string {
  return `${normalizeBaseUrl(siteUrl)}/login?ref=${encodeURIComponent(code.trim())}`;
}
