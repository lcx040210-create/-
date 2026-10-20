'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { clearAdminToken, getAdminToken } from '@/lib/admin-api';

const ADMIN_NAV = [
  { href: '/admin/withdrawals', label: '提现队列' },
  { href: '/admin/deposits', label: '充值认领' },
  { href: '/admin/manual', label: '人工待核' },
  { href: '/admin/disputes', label: '争议裁决' },
  { href: '/admin/orders', label: '订单抽查' },
  { href: '/admin/users', label: '用户管理' },
  { href: '/admin/binding-changes', label: '改绑审核' },
  { href: '/admin/reconciliation', label: '对账' },
  { href: '/admin/terms', label: '服务条款' },
];

/** 管理后台布局：独立 token 守卫（不影响用户登录态）。 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/admin/login';
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    if (!getAdminToken()) {
      router.replace('/admin/login');
      return;
    }
    setReady(true);
  }, [isLogin, router, pathname]);

  if (isLogin) {
    return <>{children}</>;
  }

  if (!ready) {
    return <p className="text-sm text-slate-500">正在验证管理员身份…</p>;
  }

  function handleLogout() {
    clearAdminToken();
    router.replace('/admin/login');
  }

  return (
    <div className="admin-shell space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
            运
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight text-slate-900">运营者工位</p>
            <p className="text-xs text-slate-500">X工作者之家 · 管理后台</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-slate-500 transition hover:text-indigo-700">
            返回前台
          </Link>
          <button type="button" className="btn-secondary py-1.5" onClick={handleLogout}>
            退出后台
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <aside className="shrink-0 lg:w-44">
          <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm lg:flex-col lg:overflow-visible">
            {ADMIN_NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? 'bg-slate-900 font-medium text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
