'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AvatarUpload } from '@/components/ui/AvatarUpload';

const EXAM_TYPES = [
  { value: 'PTE-A', label: 'PTE Academic' },
  { value: 'PTE-C', label: 'PTE Core' },
  { value: 'IELTS', label: '雅思' },
];

const SKILLS = [
  { value: 'speaking', label: '口语' },
  { value: 'writing', label: '写作' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力' },
];

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    display_name: '',
    intro: '',
    exam_types: [] as string[],
    skills: [] as string[],
    tags: [] as string[],
    avatar_url: '',
  });

  useEffect(() => {
    if (!loading && user?.role !== 'teacher') {
      router.push('/app');
    }
    if (user?.teacherProfile) {
      setForm({
        display_name: user.teacherProfile.display_name || '',
        intro: user.teacherProfile.intro || '',
        exam_types: user.teacherProfile.exam_types || [],
        skills: user.teacherProfile.skills || [],
        tags: user.teacherProfile.tags || [],
        avatar_url: user.teacherProfile.avatar_url || '',
      });
    }
  }, [user, loading]);

  function toggle(arr: string[], val: string): string[] {
    return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      await api.patch('/users/teacher-profile', form);
      setMessage('保存成功');
    } catch (err: any) {
      setMessage(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading || user?.role !== 'teacher') return null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">编辑资料</h1>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">头像</label>
        <AvatarUpload
          currentUrl={form.avatar_url}
          onUploaded={(url) => setForm((f) => ({ ...f, avatar_url: url }))}
        />
      </div>

      <Input
        label="对外展示名"
        value={form.display_name}
        onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
        className="mb-4"
      />

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">个人简介</label>
        <textarea
          value={form.intro}
          onChange={(e) => setForm((f) => ({ ...f, intro: e.target.value }))}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="介绍你的教学经验、风格..."
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">擅长考试类型</label>
        <div className="flex gap-2 flex-wrap">
          {EXAM_TYPES.map((et) => (
            <Chip
              key={et.value}
              label={et.label}
              active={form.exam_types.includes(et.value)}
              onClick={() => setForm((f) => ({ ...f, exam_types: toggle(f.exam_types, et.value) }))}
            />
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">擅长技能</label>
        <div className="flex gap-2 flex-wrap">
          {SKILLS.map((s) => (
            <Chip
              key={s.value}
              label={s.label}
              active={form.skills.includes(s.value)}
              onClick={() => setForm((f) => ({ ...f, skills: toggle(f.skills, s.value) }))}
            />
          ))}
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">标签（用逗号分隔）</label>
        <input
          type="text"
          value={form.tags.join(', ')}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
            }))
          }
          placeholder="如：口语专家, 7分保底, 十年教龄"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {message && (
        <p className={`text-sm mb-4 ${message === '保存成功' ? 'text-green-600' : 'text-red-500'}`}>
          {message}
        </p>
      )}
      <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
      }`}
    >
      {label}
    </button>
  );
}
