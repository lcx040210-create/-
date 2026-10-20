'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/api';

const NAV_LINKS = [
  { href: '/', label: '大厅' },
  { href: '/me/tasks', label: '我的任务' },
  { href: '/wallet', label: '钱包' },
  { href: '/invite', label: '邀请' },
];

export default function SiteNav() {
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(!!getAccessToken());
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-bold text-white">
            X
          </span>
          <span className="text-base font-semibold tracking-tight">X工作者之家</span>
        </Link>

        <nav className="flex flex-1 items-center gap-1 text-sm">
          {NAV_LINKS.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 transition ${
                  active
                    ? 'bg-indigo-50 font-medium text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link
          href={loggedIn ? '/me' : '/login'}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          {loggedIn ? '我的账户' : '登录 / 注册'}
        </Link>
      </div>
    </header>
  );
}
