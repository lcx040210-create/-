'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'student' as 'student' | 'teacher',
    phone: '', display_name: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      router.push('/app');
    } catch (err: any) {
      const msg = err.response?.data?.message;
      if (Array.isArray(msg)) {
        setError(msg.join('；'));
      } else {
        setError(msg || '注册失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">注册</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">我是</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'student', label: '学生' },
                { value: 'teacher', label: '老师' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('role', opt.value)}
                  className={`px-4 py-3 border-2 rounded-lg text-sm font-medium transition-colors ${
                    form.role === opt.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Input label="姓名" value={form.name} onChange={(e) => update('name', e.target.value)} required />
          <Input label="邮箱" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
          <Input label="密码（至少8位）" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={8} />
          <Input label="手机号（选填）" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} />

          {form.role === 'teacher' && (
            <Input label="对外展示名（如 Luna老师）" value={form.display_name} onChange={(e) => update('display_name', e.target.value)} required />
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          已有账户？<Link href="/app/login" className="text-blue-600 hover:underline">登录</Link>
        </p>
      </div>
    </div>
  );
}
