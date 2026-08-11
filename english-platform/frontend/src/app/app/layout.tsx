'use client';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const publicPaths = ['/app/login', '/app/register'];
  useEffect(() => {
    if (!loading && !user && !publicPaths.includes(pathname)) {
      router.push('/app/login');
    }
  }, [user, loading, pathname]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  if (publicPaths.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/app" className="text-lg font-bold text-blue-600">英语教学平台</Link>
          <div className="flex items-center gap-4">
            {user?.role === 'student' && (
              <>
                <Link href="/app/packages" className="text-sm text-gray-500 hover:text-blue-600">课包</Link>
                <Link href="/app/teachers" className="text-sm text-gray-500 hover:text-blue-600">找老师</Link>
                <Link href="/app/me" className="text-sm text-gray-500 hover:text-blue-600">我的</Link>
              </>
            )}
            {user?.role === 'teacher' && (
              <>
                <Link href="/app/profile" className="text-sm text-gray-500 hover:text-blue-600">编辑资料</Link>
                <Link href="/app/me" className="text-sm text-gray-500 hover:text-blue-600">我的</Link>
              </>
            )}
            <span className="text-sm text-gray-400">
              {user?.role === 'teacher' ? (user?.teacherProfile?.display_name || user?.name) : user?.name}
            </span>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
