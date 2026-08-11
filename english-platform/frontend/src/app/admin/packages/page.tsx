'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const EXAM_TYPES = ['PTE-A', 'PTE-C', 'IELTS'];
const SKILLS = [
  { value: 'speaking', label: '口语' },
  { value: 'writing', label: '写作' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力' },
];

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);

  const emptyForm = {
    name: '', lesson_count: 10, price: 0, valid_days: 180,
    exam_types: [] as string[], skills: [] as string[], description: '',
  };
  const [form, setForm] = useState(emptyForm);

  async function fetchPackages() {
    const { data } = await api.get('/packages/admin');
    setPackages(data);
    setLoading(false);
  }

  useEffect(() => { fetchPackages(); }, []);

  function toggle(arr: string[], v: string) {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  async function handleSave() {
    try {
      if (editing) {
        await api.patch(`/packages/${editing.id}`, form);
      } else {
        await api.post('/packages', form);
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      fetchPackages();
    } catch (err: any) {
      alert(err.response?.data?.message || '保存失败');
    }
  }

  async function handleStatus(id: string, status: string) {
    await api.patch(`/packages/${id}/status`, { status });
    fetchPackages();
  }

  function startEdit(pkg: any) {
    setEditing(pkg);
    setForm({
      name: pkg.name, lesson_count: pkg.lesson_count, price: pkg.price,
      valid_days: pkg.valid_days, exam_types: pkg.exam_types || [],
      skills: pkg.skills || [], description: pkg.description || '',
    });
    setShowForm(true);
  }

  if (loading) return <p>加载中...</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">课包管理</h1>
        <Button onClick={() => { setEditing(null); setForm(emptyForm); setShowForm(true); }}>新建课包</Button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">{editing ? '编辑课包' : '新建课包'}</h2>
            <div className="space-y-4">
              <Input label="名称" value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="课时数" type="number" value={form.lesson_count} onChange={(e) => setForm((f: any) => ({ ...f, lesson_count: +e.target.value }))} />
                <Input label="价格（元）" type="number" value={form.price} onChange={(e) => setForm((f: any) => ({ ...f, price: +e.target.value }))} />
              </div>
              <Input label="有效期（天）" type="number" value={form.valid_days} onChange={(e) => setForm((f: any) => ({ ...f, valid_days: +e.target.value }))} />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">考试类型</label>
                <div className="flex gap-2 flex-wrap">
                  {EXAM_TYPES.map((et) => (
                    <Chip key={et} label={et} active={form.exam_types.includes(et)}
                      onClick={() => setForm((f: any) => ({ ...f, exam_types: toggle(f.exam_types, et) }))} />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">技能维度</label>
                <div className="flex gap-2 flex-wrap">
                  {SKILLS.map((s) => (
                    <Chip key={s.value} label={s.label} active={form.skills.includes(s.value)}
                      onClick={() => setForm((f: any) => ({ ...f, skills: toggle(f.skills, s.value) }))} />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea value={form.description} onChange={(e) => setForm((f: any) => ({ ...f, description: e.target.value }))}
                  rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setShowForm(false)}>取消</Button>
                <Button onClick={handleSave}>保存</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {packages.map((pkg) => (
          <div key={pkg.id} className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold">{pkg.name}</h3>
              <p className="text-sm text-gray-500">{pkg.lesson_count}节 · ¥{pkg.price} · {pkg.valid_days}天有效</p>
              <span className={`text-xs px-2 py-0.5 rounded ${
                pkg.status === 'active' ? 'bg-green-100 text-green-700' : pkg.status === 'draft' ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-700'
              }`}>
                {pkg.status === 'active' ? '上架' : pkg.status === 'draft' ? '草稿' : '已归档'}
              </span>
            </div>
            <div className="flex gap-2">
              {pkg.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => handleStatus(pkg.id, 'active')}>上架</Button>}
              {pkg.status === 'active' && <Button size="sm" variant="secondary" onClick={() => handleStatus(pkg.id, 'archived')}>下架</Button>}
              <Button size="sm" variant="ghost" onClick={() => startEdit(pkg)}>编辑</Button>
            </div>
          </div>
        ))}
        {packages.length === 0 && <p className="text-gray-500">暂无课包</p>}
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
      active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
    }`}>
      {label}
    </button>
  );
}
