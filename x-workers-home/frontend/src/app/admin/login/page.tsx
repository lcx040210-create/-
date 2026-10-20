'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import adminApi, { getAdminToken, setAdminToken } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

interface AdminLoginResponse {
  accessToken: string;
  user: {
    id: string;
    address: string;
    role: string;
    status: string;
    nickname: string | null;
  };
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [alreadyLoggedIn, setAlreadyLoggedIn] = useState(false);

  useEffect(() => {
    setAlreadyLoggedIn(!!getAdminToken());
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setError('请输入管理员钱包地址');
      return;
    }
    if (!password) {
      setError('请输入管理员密码');
      return;
    }

    setBusy(true);
    try {
      const { data } = await adminApi.post<AdminLoginResponse>('/admin/login', {
        address: trimmedAddress,
        password,
      });
      setAdminToken(data.accessToken);
      router.replace('/admin/withdrawals');
    } catch (err) {
      setError(errorMessage(err, '管理员登录失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-6">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
          运
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">运营者工位</h1>
        <p className="mt-1 text-sm text-slate-600">管理员账号密码登录，与用户钱包登录互不相通。</p>
      </div>

      {alreadyLoggedIn ? (
        <div className="alert-info">
          当前浏览器已有后台登录态。
          <Link href="/admin/withdrawals" className="ml-1 underline underline-offset-2">
            直接进入后台
          </Link>
        </div>
      ) : null}

      {error ? <div className="alert-error">{error}</div> : null}

      <form className="card space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label className="label" htmlFor="admin-address">
            管理员地址
          </label>
          <input
            id="admin-address"
            className="input font-mono text-xs"
            placeholder="0x…（管理员钱包地址）"
            autoComplete="username"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={busy}
          />
        </div>

        <div>
          <label className="label" htmlFor="admin-password">
            密码
          </label>
          <input
            id="admin-password"
            type="password"
            className="input"
            placeholder="管理员密码"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? '登录中…' : '登录后台'}
        </button>

        <p className="text-xs leading-5 text-slate-500">
          管理员账号由后端 ADMIN_ADDRESS / ADMIN_PASSWORD 创建（可执行 npm run seed:admin 更新）。
          后台 token 单独存储，不会覆盖前台用户登录态。
        </p>
      </form>

      <p className="text-center text-sm text-slate-500">
        <Link href="/" className="text-indigo-600 hover:text-indigo-800 hover:underline">
          ← 返回 X工作者之家
        </Link>
      </p>
    </div>
  );
}
