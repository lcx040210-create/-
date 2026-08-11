import api from './api';

export interface LoginParams {
  email: string;
  password: string;
}

export interface RegisterParams {
  email: string;
  password: string;
  role: 'student' | 'teacher';
  name: string;
  phone?: string;
  display_name?: string;
}

export async function login(params: LoginParams) {
  const { data } = await api.post('/auth/login', params);
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}

export async function register(params: RegisterParams) {
  const { data } = await api.post('/auth/register', params);
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}

export function logout() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (refreshToken) {
    api.post('/auth/logout', { refreshToken }).catch(() => {});
  }
  localStorage.clear();
  window.location.href = '/app/login';
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem('accessToken');
}
