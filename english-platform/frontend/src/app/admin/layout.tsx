'use client';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

const adminLinks = [
  { href: '/admin', label: '📊 概览' },
  { href: '/admin/teachers', label: '👩‍🏫 老师审核' },
  { href: '/admin/packages', label: '📦 课包管理' },
  { href: '/admin/settlements', label: '💰 结算管理' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/app/login');
    }
  }, [user, loading]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <nav className="sticky top-0 z-40 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Link href="/admin" className="flex items-center gap-2.5 mr-4">
              <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-xs font-extrabold">A</span>
              </div>
              <span className="font-bold text-sm">管理后台</span>
            </Link>
            {adminLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/app" className="text-xs text-gray-500 hover:text-gray-300">前台</Link>
            <span className="text-xs text-gray-500">{user.name}</span>
            <button onClick={logout} className="text-xs text-gray-500 hover:text-red-400 transition-colors">退出</button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6 md:py-8 animate-fade-in">
        {children}
      </main>
    </div>
  );
}
