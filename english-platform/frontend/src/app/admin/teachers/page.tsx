'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';

const SKILL_LABELS: Record<string, string> = {
  speaking: '口语', writing: '写作', reading: '阅读', listening: '听力',
};

export default function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchTeachers() {
    const { data } = await api.get('/users/admin/teachers/pending');
    setTeachers(data);
    setLoading(false);
  }

  useEffect(() => { fetchTeachers(); }, []);

  async function handleReview(id: string, status: 'approved' | 'rejected') {
    await api.patch(`/users/teachers/${id}/review`, { review_status: status });
    fetchTeachers();
  }

  if (loading) return <p>加载中...</p>;
  if (teachers.length === 0) return <p className="text-gray-500">暂无待审核老师</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">老师审核</h1>
      <div className="space-y-4">
        {teachers.map((t) => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-lg">{t.display_name}</h3>
                <p className="text-sm text-gray-500">实名：{t.user?.name} | 邮箱：{t.user?.email}</p>
                <p className="text-sm text-gray-600 mt-2">{t.intro || '暂无简介'}</p>
                <div className="flex gap-2 mt-2">
                  {t.exam_types?.map((et: string) => (
                    <span key={et} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">{et}</span>
                  ))}
                  {t.skills?.map((s: string) => (
                    <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded">{SKILL_LABELS[s] || s}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleReview(t.id, 'approved')}>通过</Button>
                <Button size="sm" variant="secondary" onClick={() => handleReview(t.id, 'rejected')}>拒绝</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
