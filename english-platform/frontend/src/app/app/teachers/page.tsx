'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';

const EXAM_TYPES = ['PTE-A', 'PTE-C', 'IELTS'];
const SKILLS = [
  { value: 'speaking', label: '口语' },
  { value: 'writing', label: '写作' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力' },
];

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterExam, setFilterExam] = useState('');
  const [filterSkill, setFilterSkill] = useState('');

  async function fetchTeachers() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterExam) params.set('exam_types', filterExam);
    if (filterSkill) params.set('skills', filterSkill);
    try {
      const { data } = await api.get(`/users/teachers?${params}`);
      setTeachers(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTeachers(); }, [filterExam, filterSkill]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">老师列表</h1>

      <div className="flex gap-4 mb-6 flex-wrap">
        <select value={filterExam} onChange={(e) => setFilterExam(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">全部考试类型</option>
          {EXAM_TYPES.map((et) => (<option key={et} value={et}>{et}</option>))}
        </select>
        <select value={filterSkill} onChange={(e) => setFilterSkill(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">全部技能</option>
          {SKILLS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">加载中...</p>
      ) : teachers.length === 0 ? (
        <p className="text-gray-500">暂无符合条件的老师</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teachers.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4 mb-4">
                <img
                  src={t.avatar_url || '/default-avatar.png'}
                  alt={t.display_name}
                  className="w-16 h-16 rounded-full object-cover bg-gray-100"
                />
                <div>
                  <h3 className="font-bold text-lg">{t.display_name}</h3>
                </div>
              </div>
              <p className="text-sm text-gray-500 mb-3 line-clamp-2">{t.intro || '暂无简介'}</p>
              <div className="flex gap-1 flex-wrap mb-2">
                {t.exam_types?.map((et: string) => (
                  <span key={et} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">{et}</span>
                ))}
              </div>
              <div className="flex gap-1 flex-wrap">
                {t.skills?.map((s: string) => {
                  const label = SKILLS.find((sk) => sk.value === s)?.label;
                  return <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded">{label}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
