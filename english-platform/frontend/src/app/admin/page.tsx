'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';

interface Stats {
  totalStudents: number;
  totalTeachers: number;
  pendingTeachers: number;
  todayBookings: number;
  completedBookings: number;
  monthlyBookings: number;
  pendingSettlements: number;
  monthlySettlementAmount: number;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [trend, setTrend] = useState<{ date: string; count: number }[]>([]);

  useEffect(() => {
    api.get('/admin/stats/dashboard').then((res) => setStats(res.data));
    api.get('/admin/stats/booking-trend').then((res) => setTrend(res.data || []));
  }, []);

  if (!stats) return <div className="text-center py-12 text-gray-400">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">管理后台</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard label="学生总数" value={stats.totalStudents} />
        <StatCard label="老师总数" value={stats.totalTeachers} />
        <StatCard label="今日预约" value={stats.todayBookings} />
        <StatCard label="待审核老师" value={stats.pendingTeachers} highlight={stats.pendingTeachers > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard label="已完成课时" value={stats.completedBookings} />
        <StatCard label="本月课时" value={stats.monthlyBookings} />
        <StatCard label="待处理结算" value={stats.pendingSettlements} />
        <StatCard label="本月结算额" value={`¥${stats.monthlySettlementAmount.toLocaleString()}`} />
      </div>

      {/* 近30天预约趋势 */}
      {trend.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold mb-4">近30天预约趋势</h2>
          <div className="flex items-end gap-1 h-40">
            {trend.map((d) => {
              const maxCount = Math.max(...trend.map((t) => t.count), 1);
              const height = (d.count / maxCount) * 100;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center" title={`${d.date}: ${d.count}节`}>
                  <div
                    className="w-full bg-blue-500 rounded-t"
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                  <span className="text-[10px] text-gray-400 mt-1 rotate-45 origin-left whitespace-nowrap">
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`bg-white rounded-lg border p-6 ${highlight ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}>
      <h3 className="text-sm font-medium text-gray-500">{label}</h3>
      <p className={`mt-2 text-3xl font-bold ${highlight ? 'text-orange-600' : 'text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
}
