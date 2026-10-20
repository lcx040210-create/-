/**
 * 商单公开数据契约（与 backend/src/orders、backend/src/slots 对齐）。
 * 金额字段是十进制 XM 字符串，展示侧一律走 lib/format 的 BigInt 工具。
 */

import { fetchApiBaseUrl } from './api';

export type OrderType = 'post' | 'comment' | 'quote';
export type OrderStatus = 'recruiting' | 'closed' | 'completed';
export type OrderSort = 'new' | 'price';
export type SlotStatus =
  | 'reserved'
  | 'verifying'
  | 'passed'
  | 'disputed'
  | 'paid'
  | 'refunded'
  | 'expired';

export interface OrderRequirements {
  keywords: string[];
  hashtags: string[];
  mentions: string[];
  links: string[];
  minChars?: number;
}

export interface OrderView {
  id: string;
  type: OrderType;
  title: string;
  brief: string;
  requirements: OrderRequirements;
  targetTweetUrl: string | null;
  priceXm: string;
  payoutXm: string;
  slotsTotal: number;
  slotsAvailable: number;
  merchantRatingGrade: string | null;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
  closedAt: string | null;
}

export interface OrderSlotView {
  id: string;
  status: SlotStatus;
  acceptedAt: string;
  deliverDeadlineAt: string;
  deliveredAt: string | null;
  createdAt: string;
  creator: {
    nickname: string | null;
    ratingGrade: string | null;
  };
}

export interface OrderDetailView extends OrderView {
  slots: OrderSlotView[];
}

export interface OrderListResult {
  items: OrderView[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /me/slots 的最小字段（仅用于判断「我是否已在本单中」）。 */
export interface MySlotsResponse {
  items: Array<{ id: string; orderId: string; status: SlotStatus }>;
}

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  post: '发帖',
  comment: '评论',
  quote: '引用',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  recruiting: '招募中',
  closed: '已下架',
  completed: '已完成',
};

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  reserved: '待交付',
  verifying: '核验中',
  passed: '核验通过',
  disputed: '争议中',
  paid: '已结算',
  refunded: '已退款',
  expired: '已过期',
};

export interface OrderListQuery {
  type?: OrderType;
  sort: OrderSort;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isOrderType(value: string | undefined): value is OrderType {
  return value === 'post' || value === 'comment' || value === 'quote';
}

/** 白名单化 URL 查询参数，非法值回落到默认（全部 / 最新 / 第 1 页）。 */
export function parseOrderListSearchParams(
  searchParams: RawSearchParams,
): OrderListQuery {
  const type = firstValue(searchParams.type);
  const sort = firstValue(searchParams.sort) === 'price' ? 'price' : 'new';
  const rawPage = Number.parseInt(firstValue(searchParams.page) ?? '', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  return {
    ...(isOrderType(type) ? { type } : {}),
    sort,
    page,
  };
}

/** 大厅地址：默认值（全部 / 最新 / 第 1 页）不写进 query。 */
export function buildOrderListHref(query: Partial<OrderListQuery> = {}): string {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.sort === 'price') params.set('sort', 'price');
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

/** 未显式配置 minChars 时，与后端核验一致的类型默认字数下限。 */
export function defaultMinChars(type: OrderType): number {
  return type === 'post' ? 1 : 11;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO 时间 → `YYYY-MM-DD HH:mm`（北京时间，避免依赖服务器时区）。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const parts = DATE_TIME_FORMATTER.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

async function requestJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${fetchApiBaseUrl()}${path}`, { cache: 'no-store' });
  } catch {
    throw new Error('无法连接服务器，请确认后端服务已启动后重试');
  }

  if (!response.ok) {
    let message = '';
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) message = body.message.join('；');
      else if (typeof body.message === 'string') message = body.message;
    } catch {
      // 后端未返回 JSON 时使用兜底文案
    }
    if (response.status === 404) throw new Error(message || '商单不存在或已下架');
    throw new Error(message || `加载失败（HTTP ${response.status}）`);
  }

  return (await response.json()) as T;
}

export function fetchOrderList(query: OrderListQuery): Promise<OrderListResult> {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  params.set('sort', query.sort);
  params.set('page', String(query.page));
  return requestJson<OrderListResult>(`/orders?${params.toString()}`);
}

export function fetchOrderDetail(id: string): Promise<OrderDetailView> {
  return requestJson<OrderDetailView>(`/orders/${encodeURIComponent(id)}`);
}
