'use client';
import { useAuth } from '@/hooks/useAuth';

export default function AdminDashboard() {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">管理后台</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="总用户数" value="--" />
        <StatCard label="总课时数" value="--" />
        <StatCard label="本月收入" value="--" />
        <StatCard label="待审核老师" value="--" />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500">{label}</h3>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
