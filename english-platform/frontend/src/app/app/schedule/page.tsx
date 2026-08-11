'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';

const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface TimeSlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export default function SchedulePage() {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/schedules/mine').then((res) => {
      if (res.data && res.data.length > 0) {
        setSlots(res.data.map((s: any) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          is_active: s.is_active,
        })));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const addSlot = (day: number) => {
    setSlots([...slots, { day_of_week: day, start_time: '09:00', end_time: '17:00', is_active: true }]);
  };

  const updateSlot = (idx: number, field: string, value: any) => {
    const updated = [...slots];
    (updated[idx] as any)[field] = value;
    setSlots(updated);
  };

  const removeSlot = (idx: number) => {
    setSlots(slots.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await api.put('/schedules/mine', { slots });
      setMessage('保存成功');
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">我的时间表</h1>
      <p className="text-sm text-gray-500 mb-6">设置每周固定可上课时段，系统会自动生成未来30天的可选时间槽</p>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${message.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message}
        </div>
      )}

      <div className="space-y-4">
        {DAYS.map((dayName, dayIdx) => {
          const daySlots = slots.filter((s) => s.day_of_week === dayIdx);
          return (
            <div key={dayIdx} className="bg-white rounded-xl border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold">{dayName}</span>
                <button
                  onClick={() => addSlot(dayIdx)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + 添加时段
                </button>
              </div>
              {daySlots.length === 0 ? (
                <p className="text-sm text-gray-300">休息</p>
              ) : (
                <div className="space-y-2">
                  {slots.map((slot, idx) =>
                    slot.day_of_week === dayIdx ? (
                      <div key={idx} className="flex items-center gap-3">
                        <input
                          type="time"
                          value={slot.start_time}
                          onChange={(e) => updateSlot(idx, 'start_time', e.target.value)}
                          className="border rounded px-2 py-1 text-sm"
                        />
                        <span className="text-gray-400">—</span>
                        <input
                          type="time"
                          value={slot.end_time}
                          onChange={(e) => updateSlot(idx, 'end_time', e.target.value)}
                          className="border rounded px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => removeSlot(idx)}
                          className="text-red-400 hover:text-red-600 text-sm"
                        >
                          删除
                        </button>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <Button onClick={save} disabled={saving}>
          {saving ? '保存中...' : '保存时间表'}
        </Button>
      </div>
    </div>
  );
}
