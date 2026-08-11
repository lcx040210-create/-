'use client';
import { useAuth } from '@/hooks/useAuth';

export default function MePage() {
  const { user } = useAuth();
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
            <p className="text-gray-500 text-sm">暂无课时（课包购买功能即将上线）</p>
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
