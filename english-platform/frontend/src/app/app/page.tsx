'use client';
import { useAuth } from '@/hooks/useAuth';

export default function Dashboard() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {user.role === 'student' && '欢迎回来！'}
        {user.role === 'teacher' && '教师工作台'}
        {user.role === 'admin' && '管理后台'}
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DashboardCard title="我的角色" value={user.role === 'student' ? '学生' : user.role === 'teacher' ? '老师' : '管理员'} />
        <DashboardCard title="账户状态" value={user.status === 'active' ? '正常' : '待审核'} />
        {user.role === 'teacher' && user.teacherProfile && (
          <DashboardCard
            title="审核状态"
            value={
              user.teacherProfile.review_status === 'pending'
                ? '待审核'
                : user.teacherProfile.review_status === 'approved'
                ? '已通过'
                : '已拒绝'
            }
          />
        )}
      </div>
    </div>
  );
}

function DashboardCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
