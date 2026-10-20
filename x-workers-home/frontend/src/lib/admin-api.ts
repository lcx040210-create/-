import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './api';

/**
 * 管理端专用 axios 实例。
 *
 * 与用户登录态完全隔离：
 * - token 存在独立 key（xwh_admin_token），不会覆盖用户 accessToken / refreshToken；
 * - 不参与用户端的 401 refresh 流程，401 直接回登录页。
 */
export const ADMIN_TOKEN_KEY = 'xwh_admin_token';
export const ADMIN_LOGIN_PATH = '/admin/login';

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

const adminApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

adminApi.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

adminApi.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const original = error.config as RetryConfig | undefined;
    const url = original?.url ?? '';
    // 登录失败也是 401：只在已登录后的管理请求上清 token / 跳转，避免登录页闪回。
    if (
      error.response?.status === 401 &&
      !url.includes('/admin/login') &&
      typeof window !== 'undefined' &&
      window.location.pathname !== ADMIN_LOGIN_PATH
    ) {
      clearAdminToken();
      window.location.href = ADMIN_LOGIN_PATH;
    }
    return Promise.reject(error);
  },
);

export default adminApi;
