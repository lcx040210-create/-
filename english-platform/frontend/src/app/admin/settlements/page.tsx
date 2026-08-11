'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';

interface Settlement {
  id: string;
  teacher_id: string;
  period_start: string;
  period_end: string;
  total_lessons: number;
  base_amount: number;
  bonus_volume: number;
  bonus_rating: number;
  bonus_renewal: number;
  total_amount: number;
  status: string;
}

export default function AdminSettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // 计算表单
  const [teacherId, setTeacherId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/settlements/all'),
      api.get('/users/teachers'),
    ]).then(([sRes, tRes]) => {
      setSettlements(sRes.data || []);
      setTeachers(tRes.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const calculate = async () => {
    setCalculating(true);
    setMessage('');
    try {
      await api.post('/settlements/calculate', { teacher_id: teacherId, period_start: periodStart, period_end: periodEnd });
      setMessage('计算完成');
      const res = await api.get('/settlements/all');
      setSettlements(res.data || []);
    } catch (err: any) {
      setMessage(err.response?.data?.message || '计算失败');
    } finally {
      setCalculating(false);
    }
  };

  const confirm = async (id: string) => {
    try {
      await api.post(`/settlements/${id}/confirm`);
      const res = await api.get('/settlements/all');
      setSettlements(res.data || []);
    } catch (err: any) {
      alert(err.response?.data?.message || '确认失败');
    }
  };

  const markPaid = async (id: string) => {
    try {
      await api.post(`/settlements/${id}/paid`);
      const res = await api.get('/settlements/all');
      setSettlements(res.data || []);
    } catch (err: any) {
      alert(err.response?.data?.message || '操作失败');
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">老师结算管理</h1>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${message.includes('完成') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message}
        </div>
      )}

      {/* 计算表单 */}
      <div className="bg-white rounded-xl border p-5 mb-8">
        <h2 className="font-semibold mb-4">新建结算</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">选择老师</option>
            {teachers.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.teacherProfile?.display_name || t.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="开始日期"
          />
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="结束日期"
          />
          <Button onClick={calculate} disabled={calculating}>
            {calculating ? '计算中...' : '计算结算'}
          </Button>
        </div>
      </div>

      {/* 结算列表 */}
      <div className="space-y-4">
        {settlements.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="font-semibold">{s.teacher_id.slice(0, 8)}...</span>
                <span className="text-gray-400 ml-3 text-sm">{s.period_start} ~ {s.period_end}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-3 py-1 rounded-full ${
                  s.status === 'paid' ? 'bg-green-100 text-green-700' :
                  s.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {s.status === 'draft' ? '草稿' : s.status === 'confirmed' ? '已确认' : '已付款'}
                </span>
                {s.status === 'draft' && (
                  <button onClick={() => confirm(s.id)} className="text-sm text-blue-600 hover:underline">确认</button>
                )}
                {s.status === 'confirmed' && (
                  <button onClick={() => markPaid(s.id)} className="text-sm text-green-600 hover:underline">标记付款</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div><span className="text-gray-400">课时：</span>{s.total_lessons}</div>
              <div><span className="text-gray-400">基础：</span>¥{s.base_amount}</div>
              <div><span className="text-gray-400">量级奖金：</span>¥{s.bonus_volume}</div>
              <div><span className="text-gray-400">评分奖金：</span>¥{s.bonus_rating}</div>
              <div><span className="text-gray-400">续购奖金：</span>¥{s.bonus_renewal}</div>
            </div>
            <div className="mt-3 pt-3 border-t text-right">
              <span className="text-lg font-bold text-blue-600">合计：¥{s.total_amount}</span>
            </div>
          </div>
        ))}
        {settlements.length === 0 && <p className="text-gray-400 text-sm">暂无结算</p>}
      </div>
    </div>
  );
}
