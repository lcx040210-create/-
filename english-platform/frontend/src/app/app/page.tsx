'use client';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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

      {user.role === 'student' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuickLink href="/app/packages" title="购买课包" desc="查看课包，选择适合你的套餐" />
          <QuickLink href="/app/teachers" title="找老师" desc="浏览老师，选择适合你的课程" />
          <QuickLink href="/app/me" title="我的课时" desc="查看课时余额和预约记录" />
        </div>
      )}
      {user.role === 'teacher' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuickLink href="/app/profile" title="编辑资料" desc="设置技能标签、简介和头像" />
          <QuickLink href="/app/me" title="我的" desc="查看个人信息和审核状态" />
        </div>
      )}
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

function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 transition-colors">
      <h3 className="font-bold text-lg mb-1">{title}</h3>
      <p className="text-sm text-gray-500">{desc}</p>
    </Link>
  );
}
