'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { SkeletonCard } from '@/components/ui/Skeleton';

const EXAM_TYPES = ['PTE-A', 'PTE-C', 'IELTS'];
const SKILLS = [
  { value: 'speaking', label: '口语' },
  { value: 'writing', label: '写作' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力' },
];

const SKILL_LABELS: Record<string, string> = Object.fromEntries(SKILLS.map((s) => [s.value, s.label]));

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="page-title">找老师</h1>
          <p className="text-sm text-gray-400 mt-1">浏览认证老师，按考试类型和技能筛选</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-8 flex-wrap">
        <select
          value={filterExam}
          onChange={(e) => setFilterExam(e.target.value)}
          className="form-input w-auto min-w-[160px]"
        >
          <option value="">全部考试类型</option>
          {EXAM_TYPES.map((et) => (
            <option key={et} value={et}>{et}</option>
          ))}
        </select>
        <select
          value={filterSkill}
          onChange={(e) => setFilterSkill(e.target.value)}
          className="form-input w-auto min-w-[140px]"
        >
          <option value="">全部技能</option>
          {SKILLS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {(filterExam || filterSkill) && (
          <button
            onClick={() => { setFilterExam(''); setFilterSkill(''); }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* Teacher grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : teachers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <p className="empty-state-text">暂无符合条件的老师</p>
          {(filterExam || filterSkill) && (
            <button
              onClick={() => { setFilterExam(''); setFilterSkill(''); }}
              className="mt-3 text-sm text-primary-600 hover:underline"
            >
              清除筛选条件
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teachers.map((t) => (
            <div key={t.id} className="card-hover p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
                  {t.avatar_url ? (
                    <img src={t.avatar_url} alt={t.display_name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{t.display_name?.charAt(0) || '?'}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-lg truncate">{t.display_name}</h3>
                  {t.base_rate > 0 && (
                    <p className="text-sm text-primary-600 font-medium">¥{t.base_rate}/课时</p>
                  )}
                </div>
              </div>

              <p className="text-sm text-gray-500 mb-4 line-clamp-2 leading-relaxed">
                {t.intro || '暂无简介'}
              </p>

              <div className="flex gap-1.5 flex-wrap mb-2">
                {t.exam_types?.map((et: string) => (
                  <span key={et} className="badge-primary">{et}</span>
                ))}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {t.skills?.map((s: string) => (
                  <span key={s} className="badge-success">{SKILL_LABELS[s] || s}</span>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-50">
                <a
                  href={`/app/bookings`}
                  className="block w-full text-center py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors"
                >
                  预约课程
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
