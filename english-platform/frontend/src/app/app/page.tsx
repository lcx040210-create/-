'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import api from '@/lib/api';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    // 获取个人相关数据
    if (user.role === 'student') {
      Promise.all([
        api.get('/orders/balances'),
        api.get('/bookings/mine'),
      ]).then(([balRes, bookRes]) => {
        const bookings = bookRes.data || [];
        const upcoming = bookings.filter((b: any) => b.status === 'booked').length;
        const balances = balRes.data || [];
        const totalRemaining = balances.reduce((sum: number, b: any) => sum + b.remaining, 0);
        setStats({ upcoming, totalRemaining, totalBookings: bookings.length });
      }).catch(() => {});
    } else if (user.role === 'teacher') {
      Promise.all([
        api.get('/bookings/mine'),
        api.get('/settlements/mine'),
      ]).then(([bookRes, settleRes]) => {
        const bookings = bookRes.data || [];
        const upcoming = bookings.filter((b: any) => b.status === 'booked').length;
        const completed = bookings.filter((b: any) => b.status === 'completed').length;
        setStats({ upcoming, completed, totalBookings: bookings.length });
      }).catch(() => {});
    }
  }, [user]);

  if (!user) return null;

  const greeting = user.role === 'student' ? '欢迎回来' : user.role === 'teacher' ? '教师工作台' : '管理后台';
  const subtitle = user.role === 'student'
    ? '选择课包，预约老师，开启学习之旅'
    : '管理你的课程时间，查看教学收入';

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="page-title">{greeting}，{user.role === 'teacher' ? (user.teacherProfile?.display_name || user.name) : user.name}</h1>
        <p className="text-gray-500 mt-1">{subtitle}</p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatusCard
          label="账户状态"
          value={user.status === 'active' ? '正常' : '待审核'}
          color={user.status === 'active' ? 'green' : 'yellow'}
        />
        {user.role === 'teacher' && user.teacherProfile && (
          <StatusCard
            label="审核状态"
            value={
              user.teacherProfile.review_status === 'approved' ? '已通过' :
              user.teacherProfile.review_status === 'pending' ? '待审核' : '已拒绝'
            }
            color={
              user.teacherProfile.review_status === 'approved' ? 'green' :
              user.teacherProfile.review_status === 'pending' ? 'yellow' : 'red'
            }
          />
        )}
        {stats?.upcoming !== undefined && (
          <StatusCard label="即将上课" value={`${stats.upcoming} 节`} color="blue" />
        )}
        {stats?.totalRemaining !== undefined && (
          <StatusCard label="剩余课时" value={`${stats.totalRemaining} 节`} color="indigo" />
        )}
        {stats?.completed !== undefined && (
          <StatusCard label="已完成" value={`${stats.completed} 节`} color="green" />
        )}
      </div>

      {/* Quick links */}
      <h2 className="section-title mb-4">快捷操作</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {user.role === 'student' && (
          <>
            <QuickLink href="/app/packages" icon="📦" title="购买课包" desc="查看课包套餐，选择适合你的方案" />
            <QuickLink href="/app/teachers" icon="👩‍🏫" title="找老师" desc="浏览认证老师，按科目筛选" />
            <QuickLink href="/app/bookings" icon="📅" title="我的预约" desc="查看和管理你的课程预约" />
            <QuickLink href="/app/me" icon="📊" title="课时余额" desc="查看各科目剩余课时和有效期" />
          </>
        )}
        {user.role === 'teacher' && (
          <>
            <QuickLink href="/app/profile" icon="✏️" title="编辑资料" desc="设置技能标签、简介和头像" />
            <QuickLink href="/app/schedule" icon="🕐" title="时间表" desc="设置每周固定可上课时段" />
            <QuickLink href="/app/bookings" icon="📅" title="预约管理" desc="查看和管理学生预约" />
            <QuickLink href="/app/settlements" icon="💰" title="结算记录" desc="查看课时费和奖金明细" />
          </>
        )}
      </div>
    </div>
  );
}

function StatusCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    green: 'bg-success-50 text-success-700',
    yellow: 'bg-warning-50 text-warning-600',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    indigo: 'bg-primary-50 text-primary-700',
  };
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${colorMap[color] || 'text-gray-700'} bg-transparent`}>
        <span className={`inline-block px-2 py-0.5 -ml-2 rounded-lg ${colorMap[color]}`}>{value}</span>
      </p>
    </div>
  );
}

function QuickLink({ href, icon, title, desc }: { href: string; icon: string; title: string; desc: string }) {
  return (
    <Link href={href} className="card-hover p-5 group">
      <div className="text-2xl mb-3">{icon}</div>
      <h3 className="font-bold text-gray-900 group-hover:text-primary-600 transition-colors">{title}</h3>
      <p className="text-sm text-gray-400 mt-1">{desc}</p>
    </Link>
  );
}
