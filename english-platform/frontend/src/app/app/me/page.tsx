'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import Link from 'next/link';

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
      <h1 className="page-title mb-2">个人信息</h1>
      <p className="text-sm text-gray-400 mb-8">账户信息和课时余额</p>

      {/* Account info */}
      <div className="card p-6 mb-8">
        <h3 className="section-title mb-4">账户信息</h3>
        <div className="space-y-1">
          <InfoRow label="姓名" value={user.name} />
          <InfoRow label="角色" value={user.role === 'student' ? '🎓 学生' : user.role === 'teacher' ? '👩‍🏫 老师' : '🛡️ 管理员'} />
          <InfoRow label="账户状态" value={user.status === 'active' ? '正常' : user.status === 'pending_review' ? '待审核' : '已停用'} highlight={user.status !== 'active'} />
          <InfoRow label="注册时间" value={new Date(user.created_at).toLocaleDateString('zh-CN')} />
        </div>
      </div>

      {/* Teacher review status */}
      {user.role === 'teacher' && user.teacherProfile && (
        <div className="card p-6 mb-8">
          <h3 className="section-title mb-4">审核状态</h3>
          <div className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
            user.teacherProfile.review_status === 'approved' ? 'bg-success-50 text-success-700' :
            user.teacherProfile.review_status === 'pending' ? 'bg-warning-50 text-warning-600' :
            'bg-red-50 text-red-700'
          }`}>
            {user.teacherProfile.review_status === 'pending' && '⏳ 待审核 — 审核通过后学生才能预约你的课程'}
            {user.teacherProfile.review_status === 'approved' && '✅ 已通过 — 学生可以预约你的课程'}
            {user.teacherProfile.review_status === 'rejected' && '❌ 已拒绝 — 请联系管理员'}
          </div>
        </div>
      )}

      {/* Student balances */}
      {user.role === 'student' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title">课时余额</h3>
            {balances.length === 0 && (
              <Link href="/app/packages" className="text-sm text-primary-600 font-medium hover:underline">
                购买课包 →
              </Link>
            )}
          </div>

          {balances.length === 0 ? (
            <div className="empty-state py-8">
              <div className="empty-state-icon">📦</div>
              <p className="empty-state-text">暂无课时余额</p>
              <Link href="/app/packages" className="mt-3 text-sm text-primary-600 font-medium hover:underline">
                去购买课包
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {balances.map((b) => {
                const usedPercent = Math.round(((b.total_lessons - b.remaining) / b.total_lessons) * 100);
                const isExpiring = new Date(b.expires_at) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                return (
                  <div key={b.id} className="border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="flex gap-1.5 flex-wrap mb-1.5">
                          {b.exam_types?.map((et: string) => (
                            <span key={et} className="badge-primary text-xs">{et}</span>
                          ))}
                          {b.skills?.map((s: string) => (
                            <span key={s} className="badge-success text-xs">{SKILL_LABELS[s] || s}</span>
                          ))}
                        </div>
                        <p className={`text-xs ${isExpiring ? 'text-warning-600 font-medium' : 'text-gray-400'}`}>
                          {isExpiring ? '⚠️ ' : ''}有效期至 {b.expires_at}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-extrabold text-primary-600">{b.remaining}</p>
                        <p className="text-xs text-gray-400">/ {b.total_lessons} 节</p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all"
                        style={{ width: `${usedPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}
