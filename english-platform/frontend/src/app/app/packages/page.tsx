'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';

const SKILL_LABELS: Record<string, string> = {
  speaking: '口语', writing: '写作', reading: '阅读', listening: '听力',
};

export default function PackagesPage() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<{ order_id: string; pay_url: string; amount: number } | null>(null);
  const [payChannel, setPayChannel] = useState('wechat');

  useEffect(() => {
    api.get('/packages').then(({ data }) => { setPackages(data); setLoading(false); });
  }, []);

  async function handleBuy(packageId: string) {
    setBuying(packageId);
    try {
      const { data } = await api.post('/orders', { package_id: packageId, pay_channel: payChannel });
      setQrCode(data);
    } catch (err: any) {
      alert(err.response?.data?.message || '下单失败');
    } finally {
      setBuying(null);
    }
  }

  if (loading) return <p className="text-gray-500">加载中...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">课包</h1>

      {qrCode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setQrCode(null)}>
          <div className="bg-white rounded-xl p-8 max-w-sm w-full mx-4 text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">扫码支付</h2>
            <div className="bg-gray-100 w-48 h-48 mx-auto mb-4 flex items-center justify-center text-sm text-gray-500">
              [支付二维码]
            </div>
            <p className="text-lg font-bold mb-2">¥{qrCode.amount}</p>
            <p className="text-xs text-gray-500 mb-4">订单号：{qrCode.order_id}</p>
            <Button variant="secondary" onClick={async () => {
              try {
                await api.post('/orders/payment-callback', { order_id: qrCode.order_id });
                setQrCode(null);
                alert('支付成功！课时已到账');
              } catch (err: any) {
                alert(err.response?.data?.message || '支付失败');
              }
            }}>模拟支付成功（开发环境）</Button>
            <button className="mt-3 text-sm text-gray-400 hover:text-gray-600" onClick={() => setQrCode(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {packages.map((pkg) => (
          <div key={pkg.id} className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col">
            <h3 className="text-lg font-bold mb-2">{pkg.name}</h3>
            <p className="text-sm text-gray-500 mb-3">{pkg.description || '暂无描述'}</p>
            <div className="flex gap-1 flex-wrap mb-3">
              {pkg.exam_types?.map((et: string) => (
                <span key={et} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">{et}</span>
              ))}
              {pkg.skills?.map((s: string) => (
                <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded">{SKILL_LABELS[s] || s}</span>
              ))}
            </div>
            <div className="text-sm text-gray-500 mb-4">
              <span>{pkg.lesson_count} 节课 · 有效期 {pkg.valid_days} 天</span>
            </div>
            <div className="mt-auto flex items-center justify-between">
              <span className="text-2xl font-bold text-blue-600">¥{pkg.price}</span>
              <Button onClick={() => handleBuy(pkg.id)} disabled={buying === pkg.id}>
                {buying === pkg.id ? '...' : '购买'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
