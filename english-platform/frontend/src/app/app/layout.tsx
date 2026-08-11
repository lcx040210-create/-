'use client';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

const navLinks: Record<string, { href: string; label: string }[]> = {
  student: [
    { href: '/app', label: '🏠 首页' },
    { href: '/app/packages', label: '📦 课包' },
    { href: '/app/teachers', label: '👩‍🏫 找老师' },
    { href: '/app/bookings', label: '📅 预约' },
    { href: '/app/me', label: '👤 我的' },
  ],
  teacher: [
    { href: '/app', label: '🏠 首页' },
    { href: '/app/profile', label: '✏️ 资料' },
    { href: '/app/schedule', label: '🕐 时间表' },
    { href: '/app/bookings', label: '📅 预约' },
    { href: '/app/settlements', label: '💰 结算' },
    { href: '/app/me', label: '👤 我的' },
  ],
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const publicPaths = ['/app/login', '/app/register'];
  useEffect(() => {
    if (!loading && !user && !publicPaths.includes(pathname)) {
      router.push('/app/login');
    }
  }, [user, loading, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </div>
    );
  }

  if (publicPaths.includes(pathname)) {
    return <>{children}</>;
  }

  const links = navLinks[user?.role] || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navbar */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/app" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-extrabold">E</span>
            </div>
            <span className="font-bold text-gray-900 hidden sm:block">英语教学平台</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {links.map((link) => {
              const isActive = pathname === link.href || (link.href !== '/app' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 hidden sm:block">
              {user?.role === 'teacher' ? (user?.teacherProfile?.display_name || user?.name) : user?.name}
            </span>
            {user?.role === 'admin' && (
              <Link href="/admin" className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                管理后台
              </Link>
            )}
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-lg border-t border-gray-100 px-2 py-1.5">
        <div className="flex justify-around">
          {links.slice(0, 5).map((link) => {
            const isActive = pathname === link.href || (link.href !== '/app' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  isActive ? 'text-primary-600' : 'text-gray-400'
                }`}
              >
                <span className="text-base">{link.label.slice(0, 2)}</span>
                <span>{link.label.slice(3)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6 md:py-8 pb-20 md:pb-8 animate-fade-in">
        {children}
      </main>
    </div>
  );
}
