import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

/** 去掉尾斜杠：拼接 `/orders` 时避免出现 `//orders`。 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001/api'
).replace(/\/+$/, '');

/**
 * 当前运行环境（浏览器 / Node）下 fetch 应使用的后端 base。
 *
 * 生产同源部署时浏览器侧 `NEXT_PUBLIC_API_URL=/api` 走 Caddy；但容器内的服务端
 * fetch 无法解析相对地址，必须走容器网络（`API_INTERNAL_URL=http://api:4001/api`）。
 * API_INTERNAL_URL 用下标读取，避免被 Next 在构建期静态内联，保证 standalone
 * 镜像能在运行时读到容器编排注入的值；客户端 axios 仍只用 NEXT_PUBLIC_API_URL。
 */
export function fetchApiBaseUrl(): string {
  if (typeof window !== 'undefined') return API_BASE_URL;
  return (
    process.env['API_INTERNAL_URL'] ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4001/api'
  ).replace(/\/+$/, '');
}

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

export interface XBindingStatus {
  status: 'none' | 'pending' | 'active' | 'manual_review';
  handle: string | null;
}

export interface AuthUser {
  id: string;
  address: string;
  status: string;
  role: string;
  rating_grade: string | null;
  x_binding?: XBindingStatus;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(pair: Pick<TokenPair, 'accessToken' | 'refreshToken'>): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, pair.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, pair.refreshToken);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/** 后端 Nest 错误：message 可能是 string 或 class-validator 的 string[]。 */
export function errorMessage(err: unknown, fallback = '操作失败，请稍后重试'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    const message = data?.message;
    if (Array.isArray(message)) return message.join('；');
    // Nest 未捕获异常统一返回英文 "Internal server error"：对用户展示中文兜底。
    if (typeof message === 'string' && message && message !== 'Internal server error') {
      return message;
    }
    if (!err.response) return '网络错误，请确认后端服务已启动';
    return fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/** 刷新接口自身不能触发刷新，否则 401 会无限循环。 */
const NO_REFRESH_URLS = ['/auth/nonce', '/auth/verify', '/auth/refresh'];

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<TokenPair>(`${API_BASE_URL}/auth/refresh`, {
      refreshToken,
    });
    setTokens(data);
    return data.accessToken;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryConfig | undefined;
    const url = original?.url ?? '';
    const shouldRefresh =
      error.response?.status === 401 &&
      !!original &&
      !original._retry &&
      !NO_REFRESH_URLS.some((path) => url.includes(path));

    if (shouldRefresh) {
      original._retry = true;
      // 单飞：并发 401 共用同一次刷新，避免 refresh token 轮换互相作废。
      if (!refreshing) {
        refreshing = refreshAccessToken().finally(() => {
          refreshing = null;
        });
      }
      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }

      clearTokens();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);

export default api;
