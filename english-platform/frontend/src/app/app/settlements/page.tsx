'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface Settlement {
  id: string;
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

const STATUS_MAP: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  paid: '已付款',
};

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/settlements/mine').then((res) => {
      setSettlements(res.data || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">我的结算</h1>

      {settlements.length === 0 ? (
        <p className="text-gray-400 text-sm">暂无结算记录</p>
      ) : (
        <div className="space-y-4">
          {settlements.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">
                  {s.period_start} ~ {s.period_end}
                </div>
                <span className={`text-xs px-3 py-1 rounded-full ${
                  s.status === 'paid' ? 'bg-green-100 text-green-700' :
                  s.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {STATUS_MAP[s.status] || s.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div>
                  <div className="text-gray-400">课时数</div>
                  <div className="font-semibold">{s.total_lessons}</div>
                </div>
                <div>
                  <div className="text-gray-400">基础金额</div>
                  <div className="font-semibold">¥{s.base_amount}</div>
                </div>
                <div>
                  <div className="text-gray-400">量级奖金</div>
                  <div>¥{s.bonus_volume}</div>
                </div>
                <div>
                  <div className="text-gray-400">评分奖金</div>
                  <div>¥{s.bonus_rating}</div>
                </div>
                <div>
                  <div className="text-gray-400">续购奖金</div>
                  <div>¥{s.bonus_renewal}</div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t flex justify-end">
                <span className="text-lg font-bold text-blue-600">合计：¥{s.total_amount}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
