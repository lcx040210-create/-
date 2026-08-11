'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';

const SKILL_LABELS: Record<string, string> = {
  speaking: '口语', writing: '写作', reading: '阅读', listening: '听力',
};

export default function MePage() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<any[]>([]);

  useEffect(() => {
    if (user?.role === 'student') {
      api.get('/orders/balances').then(({ data }) => setBalances(data)).catch(() => {});
    }
  }, [user]);

  if (!user) return null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">个人信息</h1>
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <InfoRow label="姓名" value={user.name} />
        <InfoRow label="角色" value={user.role === 'student' ? '学生' : user.role === 'teacher' ? '老师' : '管理员'} />
        <InfoRow label="账户状态" value={user.status === 'active' ? '正常' : user.status === 'pending_review' ? '待审核' : '已停用'} />
        <InfoRow label="注册时间" value={new Date(user.created_at).toLocaleDateString('zh-CN')} />

        {user.role === 'student' && (
          <div>
            <h3 className="font-medium text-gray-700 mt-6 mb-3">我的课时余额</h3>
            {balances.length === 0 ? (
              <p className="text-gray-500 text-sm">暂无课时，<a href="/app/packages" className="text-blue-600">去购买课包</a></p>
            ) : (
              <div className="space-y-3">
                {balances.map((b) => (
                  <div key={b.id} className="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
                    <div>
                      <div className="flex gap-1 flex-wrap mb-1">
                        {b.exam_types?.map((et: string) => (
                          <span key={et} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">{et}</span>
                        ))}
                        {b.skills?.map((s: string) => (
                          <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded">{SKILL_LABELS[s] || s}</span>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500">有效期至 {b.expires_at}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-blue-600">{b.remaining}</p>
                      <p className="text-xs text-gray-400">/ {b.total_lessons} 节</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {user.role === 'teacher' && user.teacherProfile && (
          <div>
            <h3 className="font-medium text-gray-700 mt-6 mb-3">审核状态</h3>
            <p className="text-sm">
              {user.teacherProfile.review_status === 'pending' && '⏳ 待审核'}
              {user.teacherProfile.review_status === 'approved' && '✅ 已通过'}
              {user.teacherProfile.review_status === 'rejected' && '❌ 已拒绝'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
