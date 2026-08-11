'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
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
      <h1 className="page-title mb-2">编辑资料</h1>
      <p className="text-sm text-gray-400 mb-8">完善你的个人资料，吸引更多学生</p>

      <div className="card p-6 space-y-6">
        {/* Avatar */}
        <div>
          <label className="form-label">头像</label>
          <AvatarUpload
            currentUrl={form.avatar_url}
            onUploaded={(url) => setForm((f) => ({ ...f, avatar_url: url }))}
          />
        </div>

        <Input
          label="对外展示名"
          value={form.display_name}
          onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          placeholder="如 Luna老师"
        />

        <div>
          <label className="form-label">个人简介</label>
          <textarea
            value={form.intro}
            onChange={(e) => setForm((f) => ({ ...f, intro: e.target.value }))}
            rows={4}
            className="form-input"
            placeholder="介绍你的教学经验、风格、成果..."
          />
        </div>

        <div>
          <label className="form-label">擅长考试类型</label>
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

        <div>
          <label className="form-label">擅长技能</label>
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

        <div>
          <label className="form-label">标签（用逗号分隔）</label>
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
            className="form-input"
          />
        </div>

        {message && (
          <div className={`px-4 py-2.5 rounded-xl text-sm font-medium ${
            message === '保存成功' ? 'bg-success-50 text-success-700' : 'bg-red-50 text-red-600'
          }`}>
            {message}
          </div>
        )}

        <Button onClick={handleSave} loading={saving} size="lg">
          保存资料
        </Button>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm rounded-xl font-medium transition-all duration-200 ${
        active
          ? 'bg-primary-600 text-white shadow-sm'
          : 'bg-gray-50 text-gray-600 border-2 border-transparent hover:border-primary-300 hover:bg-primary-50'
      }`}
    >
      {label}
    </button>
  );
}
