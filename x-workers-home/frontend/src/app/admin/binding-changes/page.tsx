'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BTN_SMALL,
  BTN_SMALL_DANGER,
  ConfirmDialog,
  FilterTabs,
  Modal,
  PageHeader,
  Pill,
  StateRow,
  Td,
  Th,
  TableShell,
  type PillTone,
} from '@/components/admin/ui';
import adminApi from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';

type BindingChangeStatus = 'pending' | 'approved' | 'rejected';
type Filter = BindingChangeStatus | 'all';

interface BindingChangeRow {
  id: string;
  userId: string;
  kind: 'wallet' | 'x';
  newValue: string;
  status: BindingChangeStatus;
  effectiveAt: string;
  appliedAt: string | null;
  createdAt: string;
  user: { id: string; address: string; nickname: string | null } | null;
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
  { value: 'all', label: '全部' },
];

const STATUS_LABEL: Record<BindingChangeStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const STATUS_TONE: Record<BindingChangeStatus, PillTone> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
};

const KIND_LABEL: Record<BindingChangeRow['kind'], string> = {
  wallet: '更换钱包',
  x: '更换 X 账号',
};

export default function AdminBindingChangesPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<BindingChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [approveTarget, setApproveTarget] = useState<BindingChangeRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<BindingChangeRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = filter === 'all' ? {} : { status: filter };
      const { data } = await adminApi.get<BindingChangeRow[]>('/admin/binding-changes', {
        params,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, '加载改绑申请失败'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove() {
    if (!approveTarget) return;
    const target = approveTarget;
    setBusy(true);
    setError('');
    try {
      await adminApi.post(`/admin/binding-changes/${target.id}/approve`);
      setNotice(
        `已通过${KIND_LABEL[target.kind]}申请：${target.newValue}。冷静期结束后自动生效。`,
      );
      setApproveTarget(null);
      await load();
    } catch (err) {
      const message = errorMessage(err, '审核通过失败');
      setError(message);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setFormError('请填写驳回理由');
      return;
    }
    const target = rejectTarget;
    setBusy(true);
    setError('');
    try {
      await adminApi.post(`/admin/binding-changes/${target.id}/reject`, { reason });
      setNotice(`已驳回${KIND_LABEL[target.kind]}申请。`);
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (err) {
      const message = errorMessage(err, '驳回失败');
      setError(message);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="改绑审核"
        description="用户更换钱包 / X 账号需审核；通过后仍需等冷静期结束才会真正生效。"
        actions={
          <>
            <FilterTabs
              value={filter}
              options={FILTERS}
              busy={loading || busy}
              onChange={(value) => setFilter(value as Filter)}
            />
            <button
              type="button"
              className="btn-secondary py-1.5"
              onClick={() => void load()}
              disabled={loading || busy}
            >
              刷新
            </button>
          </>
        }
      />

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      <TableShell>
        <thead>
          <tr>
            <Th>用户</Th>
            <Th>类型</Th>
            <Th>新值</Th>
            <Th>状态</Th>
            <Th>冷静期结束</Th>
            <Th>已生效</Th>
            <Th>申请时间</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <StateRow
            colSpan={8}
            loading={loading}
            empty={rows.length === 0}
            emptyLabel="暂无改绑申请。"
          />
          {!loading &&
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/60">
                <Td>
                  <p className="font-medium text-slate-900">{row.user?.nickname || '未命名用户'}</p>
                  <p className="mt-0.5 max-w-[220px] break-all font-mono text-[11px] text-slate-500">
                    {row.user?.address ?? row.userId}
                  </p>
                </Td>
                <Td>
                  <Pill tone={row.kind === 'wallet' ? 'violet' : 'sky'}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </Pill>
                </Td>
                <Td>
                  <span className="block max-w-[220px] break-all font-mono text-xs text-slate-800">
                    {row.kind === 'x' ? `@${row.newValue.replace(/^@/, '')}` : row.newValue}
                  </span>
                </Td>
                <Td>
                  <Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill>
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(row.effectiveAt)}
                  </span>
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-xs text-slate-600">
                    {row.appliedAt ? formatDateTime(row.appliedAt) : '—'}
                  </span>
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(row.createdAt)}
                  </span>
                </Td>
                <Td>
                  {row.status === 'pending' ? (
                    <div className="flex flex-col items-start gap-1.5">
                      <button
                        type="button"
                        className={BTN_SMALL}
                        disabled={busy}
                        onClick={() => {
                          setFormError('');
                          setApproveTarget(row);
                        }}
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        className={BTN_SMALL_DANGER}
                        disabled={busy}
                        onClick={() => {
                          setFormError('');
                          setRejectReason('');
                          setRejectTarget(row);
                        }}
                      >
                        驳回
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">已处理</span>
                  )}
                </Td>
              </tr>
            ))}
        </tbody>
      </TableShell>

      <ConfirmDialog
        open={!!approveTarget}
        title="确认通过改绑申请？"
        busy={busy}
        confirmLabel="确认通过"
        onCancel={() => {
          if (!busy) setApproveTarget(null);
        }}
        onConfirm={() => void handleApprove()}
        description={
          approveTarget ? (
            <div className="space-y-1">
              <p>
                用户：{approveTarget.user?.nickname || '未命名'}（
                <span className="break-all font-mono text-xs">
                  {approveTarget.user?.address ?? approveTarget.userId}
                </span>
                ）
              </p>
              <p>
                {KIND_LABEL[approveTarget.kind]} →{' '}
                <span className="break-all font-mono text-xs">{approveTarget.newValue}</span>
              </p>
              <p className="text-amber-700">
                通过后不会立即生效，需等冷静期结束（{formatDateTime(approveTarget.effectiveAt)}）。
              </p>
              {formError ? <div className="alert-error">{formError}</div> : null}
            </div>
          ) : null
        }
      />

      <Modal
        open={!!rejectTarget}
        title="驳回改绑申请"
        onClose={() => {
          if (!busy) setRejectTarget(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setRejectTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className={BTN_SMALL_DANGER + ' px-4 py-2 text-sm'}
              disabled={busy}
              onClick={() => void handleReject()}
            >
              {busy ? '处理中…' : '确认驳回'}
            </button>
          </>
        }
      >
        {rejectTarget ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              驳回后本次改绑申请失效；用户可重新发起（需重新等待冷静期）。
            </p>
            <div>
              <label className="label" htmlFor="binding-reject-reason">
                驳回理由
              </label>
              <textarea
                id="binding-reject-reason"
                className="input min-h-[88px] resize-y"
                placeholder="例如：新地址与原地址归属存疑，请补充证明材料"
                value={rejectReason}
                onChange={(event) => {
                  setRejectReason(event.target.value);
                  setFormError('');
                }}
                disabled={busy}
              />
            </div>
            {formError ? <div className="alert-error">{formError}</div> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
