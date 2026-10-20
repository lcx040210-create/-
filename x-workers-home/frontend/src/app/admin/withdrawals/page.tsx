'use client';

import { useCallback, useEffect, useState } from 'react';
import CopyButton from '@/components/CopyButton';
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

type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected';
type Filter = WithdrawalStatus | 'all';

interface AdminWithdrawal {
  id: string;
  userId: string;
  address: string;
  amountXm: string;
  feeXm: string;
  payoutXm: string;
  status: WithdrawalStatus;
  rejectReason: string | null;
  txHash: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    address: string;
    nickname: string | null;
    status: string;
  } | null;
  isFirst: boolean;
  isNewAddress: boolean;
  flagged24h: boolean;
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已审核待打款' },
  { value: 'paid', label: '已打款' },
  { value: 'rejected', label: '已驳回' },
  { value: 'all', label: '全部' },
];

const STATUS_LABEL: Record<WithdrawalStatus, string> = {
  pending: '待审核',
  approved: '待打款',
  paid: '已打款',
  rejected: '已驳回',
};

const STATUS_TONE: Record<WithdrawalStatus, PillTone> = {
  pending: 'amber',
  approved: 'sky',
  paid: 'green',
  rejected: 'red',
};

const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export default function AdminWithdrawalsPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [approveTarget, setApproveTarget] = useState<AdminWithdrawal | null>(null);
  const [paidTarget, setPaidTarget] = useState<AdminWithdrawal | null>(null);
  const [txHash, setTxHash] = useState('');
  const [rejectTarget, setRejectTarget] = useState<AdminWithdrawal | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = filter === 'all' ? {} : { status: filter };
      const { data } = await adminApi.get<AdminWithdrawal[]>('/admin/withdrawals', {
        params,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, '加载提现队列失败'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true);
    setFormError('');
    try {
      await action();
      setNotice(success);
      setApproveTarget(null);
      setPaidTarget(null);
      setRejectTarget(null);
      setTxHash('');
      setRejectReason('');
      await load();
    } catch (err) {
      const message = errorMessage(err, '操作失败');
      setFormError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function handleApprove() {
    if (!approveTarget) return;
    const target = approveTarget;
    void runAction(
      async () => {
        await adminApi.post(`/admin/withdrawals/${target.id}/approve`);
      },
      `已通过提现 ${target.amountXm} XM（实付 ${target.payoutXm} XM），等待打款。`,
    );
  }

  function handlePaid() {
    if (!paidTarget) return;
    const hash = txHash.trim();
    if (!TX_HASH_PATTERN.test(hash)) {
      setFormError('请输入 0x 开头的 64 位交易哈希');
      return;
    }
    const target = paidTarget;
    void runAction(
      async () => {
        await adminApi.post(`/admin/withdrawals/${target.id}/paid`, { txHash: hash });
      },
      `已标记打款：${target.payoutXm} XM → ${target.address.slice(0, 10)}…`,
    );
  }

  function handleReject() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setFormError('请填写驳回理由');
      return;
    }
    const target = rejectTarget;
    void runAction(
      async () => {
        await adminApi.post(`/admin/withdrawals/${target.id}/reject`, { reason });
      },
      `已驳回提现 ${target.amountXm} XM，冻结金额已退回用户可用余额。`,
    );
  }

  function openPaid(target: AdminWithdrawal) {
    setFormError('');
    setTxHash('');
    setPaidTarget(target);
  }

  function openReject(target: AdminWithdrawal) {
    setFormError('');
    setRejectReason('');
    setRejectTarget(target);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="提现队列"
        description="首要工位：核对收款地址与风控标记后再放行或打款。列表最多展示最近 200 条。"
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
            <Th>收款地址</Th>
            <Th>金额</Th>
            <Th>实付</Th>
            <Th>风控标记</Th>
            <Th>状态</Th>
            <Th>申请时间</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <StateRow
            colSpan={8}
            loading={loading}
            empty={rows.length === 0}
            emptyLabel="暂无提现记录。"
          />
          {!loading &&
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/60">
                <Td>
                  <p className="font-medium text-slate-900">{row.user?.nickname || '未命名用户'}</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">
                    {row.user?.address ?? row.userId}
                  </p>
                  {row.user?.status === 'suspended' ? (
                    <span className="mt-1 inline-block text-[11px] font-medium text-rose-600">
                      账号已封禁
                    </span>
                  ) : null}
                </Td>
                <Td>
                  <p className="break-all font-mono text-xs text-slate-700">{row.address}</p>
                  <CopyButton
                    text={row.address}
                    label="复制地址"
                    className={`${BTN_SMALL} mt-1`}
                  />
                </Td>
                <Td>
                  <p className="font-semibold tabular-nums text-slate-900">{row.amountXm} XM</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">手续费 {row.feeXm} XM</p>
                </Td>
                <Td>
                  <p className="font-semibold tabular-nums text-emerald-700">
                    {row.payoutXm} XM
                  </p>
                </Td>
                <Td>
                  <div className="flex max-w-[140px] flex-wrap gap-1">
                    {row.isFirst ? <Pill tone="amber">首提</Pill> : null}
                    {row.isNewAddress ? <Pill tone="violet">新地址</Pill> : null}
                    {row.flagged24h ? <Pill tone="red">24h 多次</Pill> : null}
                    {!row.isFirst && !row.isNewAddress && !row.flagged24h ? (
                      <span className="text-xs text-slate-400">无</span>
                    ) : null}
                  </div>
                </Td>
                <Td>
                  <Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill>
                  {row.txHash ? (
                    <a
                      href={`https://bscscan.com/tx/${row.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block max-w-[120px] truncate font-mono text-[11px] text-indigo-600 hover:underline"
                      title={row.txHash}
                    >
                      {row.txHash}
                    </a>
                  ) : null}
                  {row.rejectReason ? (
                    <p className="mt-1 max-w-[160px] text-[11px] leading-4 text-rose-600">
                      驳回：{row.rejectReason}
                    </p>
                  ) : null}
                </Td>
                <Td>
                  <p className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(row.createdAt)}
                  </p>
                  {row.reviewedAt ? (
                    <p className="mt-0.5 whitespace-nowrap text-[11px] text-slate-400">
                      审核 {formatDateTime(row.reviewedAt)}
                    </p>
                  ) : null}
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-1.5">
                    {row.status === 'pending' ? (
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
                    ) : null}
                    {row.status === 'approved' ? (
                      <button
                        type="button"
                        className={BTN_SMALL}
                        disabled={busy}
                        onClick={() => openPaid(row)}
                      >
                        已打款
                      </button>
                    ) : null}
                    {row.status === 'pending' || row.status === 'approved' ? (
                      <button
                        type="button"
                        className={BTN_SMALL_DANGER}
                        disabled={busy}
                        onClick={() => openReject(row)}
                      >
                        驳回
                      </button>
                    ) : null}
                    {row.status === 'paid' || row.status === 'rejected' ? (
                      <span className="text-xs text-slate-400">已处理</span>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
        </tbody>
      </TableShell>

      <ConfirmDialog
        open={!!approveTarget}
        title="确认通过提现？"
        danger
        busy={busy}
        confirmLabel="确认通过"
        onCancel={() => {
          if (!busy) setApproveTarget(null);
        }}
        onConfirm={handleApprove}
        description={
          approveTarget ? (
            <div className="space-y-1">
              <p>
                用户 <span className="font-mono">{approveTarget.user?.address ?? approveTarget.userId}</span>
              </p>
              <p>
                金额 <strong>{approveTarget.amountXm} XM</strong>，实付{' '}
                <strong>{approveTarget.payoutXm} XM</strong> → {approveTarget.address}
              </p>
              <p className="text-amber-700">
                通过后进入待打款状态；如需撤销只能驳回并解冻。请再次核对收款地址。
              </p>
              {formError ? <div className="alert-error">{formError}</div> : null}
            </div>
          ) : null
        }
      />

      <Modal
        open={!!paidTarget}
        title="标记已打款"
        onClose={() => {
          if (!busy) setPaidTarget(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setPaidTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={handlePaid}
            >
              {busy ? '处理中…' : '确认已打款'}
            </button>
          </>
        }
      >
        {paidTarget ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6">
              <p>
                实付 <strong>{paidTarget.payoutXm} XM</strong> →{' '}
                <span className="break-all font-mono text-xs">{paidTarget.address}</span>
              </p>
              <p className="text-xs text-slate-500">
                手续费 {paidTarget.feeXm} XM 已包含在申请金额中。
              </p>
            </div>
            <div>
              <label className="label" htmlFor="tx-hash">
                打款交易哈希（BSC）
              </label>
              <input
                id="tx-hash"
                className="input font-mono text-xs"
                placeholder="0x…（64 位十六进制）"
                value={txHash}
                onChange={(event) => {
                  setTxHash(event.target.value);
                  setFormError('');
                }}
                disabled={busy}
              />
            </div>
            <p className="text-xs leading-5 text-rose-600">
              此操作会核销用户冻结余额并记录链上哈希，不可重复、不可撤销。
            </p>
            {formError ? <div className="alert-error">{formError}</div> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!rejectTarget}
        title="驳回提现"
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
              onClick={handleReject}
            >
              {busy ? '处理中…' : '确认驳回'}
            </button>
          </>
        }
      >
        {rejectTarget ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              驳回后冻结金额 <strong>{rejectTarget.amountXm} XM</strong>{' '}
              将全额退回用户可用余额，用户可见驳回理由。
            </p>
            <div>
              <label className="label" htmlFor="reject-reason">
                驳回理由
              </label>
              <textarea
                id="reject-reason"
                className="input min-h-[88px] resize-y"
                placeholder="例如：收款地址与绑定钱包不符，请使用绑定钱包重新申请"
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
