'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';

interface Slot {
  date: string;
  time: string;
  available: boolean;
}

interface Booking {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  student_id?: string;
  teacher_id?: string;
}

export default function BookingsPage() {
  const [user, setUser] = useState<any>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [loading, setLoading] = useState(true);
  const [bookingSlot, setBookingSlot] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/users/me'),
      api.get('/bookings/mine'),
    ]).then(([userRes, bookingRes]) => {
      setUser(userRes.data);
      setBookings(bookingRes.data || []);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user?.role === 'student') {
      api.get('/users/teachers').then((res) => {
        setTeachers(res.data || []);
      });
    }
  }, [user]);

  const loadSlots = async (teacherId: string) => {
    setSelectedTeacher(teacherId);
    try {
      const res = await api.get(`/bookings/slots/${teacherId}`);
      setSlots(res.data.slots || []);
    } catch {
      setSlots([]);
    }
  };

  const book = async () => {
    if (!bookingSlot) return;
    setMessage('');
    try {
      await api.post('/bookings', {
        teacher_id: selectedTeacher,
        start_time: bookingSlot,
      });
      setMessage('预约成功！');
      setShowModal(false);
      setBookingSlot('');
      // 刷新列表
      const res = await api.get('/bookings/mine');
      setBookings(res.data || []);
    } catch (err: any) {
      setMessage(err.response?.data?.message || '预约失败');
    }
  };

  const cancel = async (id: string) => {
    if (!confirm('确定取消？距上课不足12小时将不退课时')) return;
    try {
      const res = await api.post(`/bookings/${id}/cancel`);
      alert(res.data.refunded ? '已取消，课时已退回' : '已取消，但不退课时（不足12小时）');
      const list = await api.get('/bookings/mine');
      setBookings(list.data || []);
    } catch (err: any) {
      alert(err.response?.data?.message || '取消失败');
    }
  };

  const formatTime = (t: string) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (loading) return <div className="text-center py-12 text-gray-400">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">我的预约</h1>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${message.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message}
        </div>
      )}

      {/* 学生：预约入口 */}
      {user?.role === 'student' && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">预约新课</h2>
          <div className="flex gap-3">
            <select
              value={selectedTeacher}
              onChange={(e) => loadSlots(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm min-w-[200px]"
            >
              <option value="">选择老师</option>
              {teachers.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.teacherProfile?.display_name || t.name}
                </option>
              ))}
            </select>
          </div>

          {slots.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {slots
                .filter((s) => s.available)
                .slice(0, 60)
                .map((s, i) => {
                  const slotKey = `${s.date}T${s.time}:00`;
                  return (
                    <button
                      key={`${slotKey}-${i}`}
                      onClick={() => { setBookingSlot(slotKey); setShowModal(true); }}
                      className="text-xs border rounded-lg px-3 py-2 hover:bg-blue-50 hover:border-blue-300 text-left"
                    >
                      <div className="text-gray-500">{s.date.slice(5)}</div>
                      <div className="font-semibold">{s.time}</div>
                    </button>
                  );
                })}
              {slots.filter((s) => s.available).length === 0 && (
                <p className="text-sm text-gray-400 col-span-full">该老师暂无可用时段</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 预约列表 */}
      <h2 className="text-lg font-semibold mb-3">预约列表</h2>
      {bookings.length === 0 ? (
        <p className="text-gray-400 text-sm">暂无预约</p>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="bg-white rounded-xl border p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{formatTime(b.start_time)} — {formatTime(b.end_time).split(' ')[1]}</div>
                <div className="text-sm text-gray-400">
                  {b.status === 'booked' ? '已预约' : b.status === 'completed' ? '已完成' : b.status === 'cancelled' ? '已取消' : '未出席'}
                </div>
              </div>
              {b.status === 'booked' && (
                <button
                  onClick={() => cancel(b.id)}
                  className="text-sm text-red-500 hover:text-red-700"
                >
                  取消
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 确认弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-2">确认预约</h3>
            <p className="text-sm text-gray-500 mb-4">
              时间：{bookingSlot ? formatTime(bookingSlot) : ''}
            </p>
            <div className="flex gap-3">
              <Button onClick={book} className="flex-1">确认</Button>
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 text-sm text-gray-500 border rounded-lg hover:bg-gray-50">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
