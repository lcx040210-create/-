'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/lib/auth';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login({ email, password });
      if (user.role === 'admin') {
        router.push('/admin');
      } else {
        router.push('/app');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-primary-50 via-white to-accent-50">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-200">
            <span className="text-white text-2xl font-extrabold">E</span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900">欢迎回来</h1>
          <p className="text-sm text-gray-500 mt-1">登录你的英语学习账户</p>
        </div>

        {/* Form card */}
        <div className="card p-6 shadow-card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="邮箱"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
            <Input
              label="密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            {error && (
              <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-xl">{error}</div>
            )}
            <Button type="submit" className="w-full" size="lg" loading={loading}>
              登录
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-500">
              还没有账户？{' '}
              <Link href="/app/register" className="link">
                免费注册
              </Link>
            </p>
          </div>
        </div>

        <p className="mt-6 text-center">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← 返回首页
          </Link>
        </p>
      </div>
    </div>
  );
}
