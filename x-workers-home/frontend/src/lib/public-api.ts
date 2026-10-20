/**
 * 服务端公开数据请求（SSR / OG 图 / 客户端均可复用）。
 * 后端公开端点无需 JWT；这里不使用共享 axios，避免 401 拦截器把匿名访问者踢去登录。
 */

import { fetchApiBaseUrl } from './api';

export class PublicApiError extends Error {
  /** HTTP 状态码；网络不可达时为 0。 */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PublicApiError';
    this.status = status;
  }
}

export async function getPublicJson<T>(
  path: string,
  notFoundMessage = '内容不存在',
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${fetchApiBaseUrl()}${path}`, { cache: 'no-store' });
  } catch {
    throw new PublicApiError('无法连接服务器，请确认后端服务已启动', 0);
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
    if (response.status === 404) {
      throw new PublicApiError(message || notFoundMessage, 404);
    }
    throw new PublicApiError(message || `加载失败（HTTP ${response.status}）`, response.status);
  }

  return (await response.json()) as T;
}
