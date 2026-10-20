'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import api, { AuthUser, clearTokens, errorMessage, getAccessToken } from '@/lib/api';

const USER_STATUS_LABEL: Record<string, string> = {
  pending_x_binding: '待绑定 X',
  active: '正常',
  suspended: '已封禁',
};

const ROLE_LABEL: Record<string, string> = {
  user: '用户',
  admin: '管理员',
};

const BINDING_STATUS_LABEL: Record<string, string> = {
  none: '未绑定',
  pending: '验证中',
  active: '已绑定',
  manual_review: '人工审核中',
};

export default function MePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api
      .get<AuthUser>('/auth/me')
      .then(({ data }) => {
        if (!cancelled) setUser(data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, '加载账户信息失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  function handleLogout() {
    clearTokens();
    router.replace('/login');
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">我的账户</h1>
        <button type="button" className="btn-secondary" onClick={handleLogout}>
          退出登录
        </button>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}
      {loading ? <p className="text-sm text-slate-500">加载中…</p> : null}

      {user ? (
        <div className="card space-y-5">
          <div>
            <p className="text-sm text-slate-500">钱包地址</p>
            <p className="mt-1 break-all font-mono text-sm">{user.address}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-slate-500">账号状态</p>
              <p className="mt-1 text-sm font-medium">
                {USER_STATUS_LABEL[user.status] ?? user.status}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">角色</p>
              <p className="mt-1 text-sm font-medium">
                {ROLE_LABEL[user.role] ?? user.role}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">评分等级</p>
              <p className="mt-1 text-sm font-medium">{user.rating_grade ?? '暂无'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">X 绑定</p>
              <p className="mt-1 text-sm font-medium">
                {BINDING_STATUS_LABEL[user.x_binding?.status ?? 'none'] ??
                  user.x_binding?.status ??
                  '未绑定'}
                {user.x_binding?.handle ? (
                  <span className="ml-2 font-normal text-slate-500">
                    @{user.x_binding.handle}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          {user.status !== 'active' || user.x_binding?.status !== 'active' ? (
            <div className="alert-info">
              完成 X 绑定并通过验证后，账号才会激活。
              <button
                type="button"
                className="ml-1 underline underline-offset-2"
                onClick={() => router.push('/login')}
              >
                前往绑定
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
