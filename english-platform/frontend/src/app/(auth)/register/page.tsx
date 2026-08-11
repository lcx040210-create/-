'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

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
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-primary-50 via-white to-accent-50">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-200">
            <span className="text-white text-2xl font-extrabold">E</span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900">创建账户</h1>
          <p className="text-sm text-gray-500 mt-1">开始你的英语学习之旅</p>
        </div>

        <div className="card p-6 shadow-card">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Role selector */}
            <div>
              <label className="form-label">我是</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'student', label: '🎓 学生', desc: '我要上课' },
                  { value: 'teacher', label: '👩‍🏫 老师', desc: '我来教学' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update('role', opt.value)}
                    className={`p-4 border-2 rounded-xl text-left transition-all duration-200 ${
                      form.role === opt.value
                        ? 'border-primary-500 bg-primary-50 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold text-sm">{opt.label}</div>
                    <div className={`text-xs mt-0.5 ${form.role === opt.value ? 'text-primary-500' : 'text-gray-400'}`}>
                      {opt.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <Input label="姓名" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="你的真实姓名" required />
            <Input label="邮箱" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="your@email.com" required />
            <Input label="密码" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="至少8位" required minLength={8} hint="至少8位字符" />
            <Input label="手机号" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="选填" />

            {form.role === 'teacher' && (
              <Input label="展示名" value={form.display_name} onChange={(e) => update('display_name', e.target.value)} placeholder="如 Luna老师" hint="学生看到的老师名称" required />
            )}

            {error && (
              <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-xl">{error}</div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              注册
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-500">
              已有账户？{' '}
              <Link href="/app/login" className="link">
                立即登录
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
