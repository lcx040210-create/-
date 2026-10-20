'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BTN_SMALL,
  FilterTabs,
  Modal,
  PageHeader,
  Pill,
  StateRow,
  Td,
  Th,
  TableShell,
} from '@/components/admin/ui';
import adminApi from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';

type DepositStatus = 'unmatched' | 'credited';
type Filter = DepositStatus | 'all';

interface AdminDeposit {
  id: string;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  userId: string | null;
  amount: string;
  amountMicro: string;
  status: DepositStatus;
  blockNumber: number;
  createdAt: string;
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'unmatched', label: '未匹配' },
  { value: 'credited', label: '已入账' },
  { value: 'all', label: '全部' },
];

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export default function AdminDepositsPage() {
  const [filter, setFilter] = useState<Filter>('unmatched');
  const [rows, setRows] = useState<AdminDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [claimTarget, setClaimTarget] = useState<AdminDeposit | null>(null);
  const [userAddress, setUserAddress] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = filter === 'all' ? {} : { status: filter };
      const { data } = await adminApi.get<AdminDeposit[]>('/admin/deposits', { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, '加载充值列表失败'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  function openClaim(deposit: AdminDeposit) {
    setFormError('');
    setUserAddress('');
    setClaimTarget(deposit);
  }

  async function handleClaim() {
    if (!claimTarget) return;
    const address = userAddress.trim();
    if (!ADDRESS_PATTERN.test(address)) {
      setFormError('请输入 0x 开头的 40 位十六进制用户地址');
      return;
    }

    setBusy(true);
    setFormError('');
    try {
      await adminApi.post(`/admin/deposits/${claimTarget.id}/claim`, {
        userAddress: address,
      });
      setNotice(
        `已将充值 ${claimTarget.amount} USDT 认领给 ${address.slice(0, 10)}…，用户余额已入账。`,
      );
      setClaimTarget(null);
      await load();
    } catch (err) {
      const message = errorMessage(err, '认领失败');
      setFormError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="充值认领"
        description="链上已到账但未能自动匹配的充值，核对交易后手动认领给用户；认领即入账，不能撤销。"
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
            <Th>交易</Th>
            <Th>来源地址</Th>
            <Th>金额</Th>
            <Th>区块</Th>
            <Th>状态</Th>
            <Th>到账时间</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <StateRow
            colSpan={7}
            loading={loading}
            empty={rows.length === 0}
            emptyLabel="暂无充值记录。"
          />
          {!loading &&
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/60">
                <Td>
                  <a
                    href={`https://bscscan.com/tx/${row.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-[220px] break-all font-mono text-xs text-indigo-600 hover:underline"
                  >
                    {row.txHash}
                  </a>
                  <p className="mt-0.5 text-[11px] text-slate-400">log #{row.logIndex}</p>
                </Td>
                <Td>
                  <p className="max-w-[220px] break-all font-mono text-xs text-slate-700">
                    {row.fromAddress}
                  </p>
                </Td>
                <Td>
                  <p className="whitespace-nowrap font-semibold tabular-nums text-slate-900">
                    {row.amount} USDT
                  </p>
                </Td>
                <Td>
                  <span className="text-xs tabular-nums text-slate-600">{row.blockNumber}</span>
                </Td>
                <Td>
                  <Pill tone={row.status === 'credited' ? 'green' : 'amber'}>
                    {row.status === 'credited' ? '已入账' : '未匹配'}
                  </Pill>
                  {row.userId ? (
                    <p className="mt-1 max-w-[120px] break-all font-mono text-[10px] text-slate-400">
                      {row.userId}
                    </p>
                  ) : null}
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(row.createdAt)}
                  </span>
                </Td>
                <Td>
                  {row.status === 'unmatched' ? (
                    <button
                      type="button"
                      className={BTN_SMALL}
                      disabled={busy}
                      onClick={() => openClaim(row)}
                    >
                      认领给用户
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">已处理</span>
                  )}
                </Td>
              </tr>
            ))}
        </tbody>
      </TableShell>

      <Modal
        open={!!claimTarget}
        title="认领充值"
        onClose={() => {
          if (!busy) setClaimTarget(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setClaimTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void handleClaim()}
            >
              {busy ? '认领中…' : '确认认领并入账'}
            </button>
          </>
        }
      >
        {claimTarget ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6">
              <p>
                交易 <span className="break-all font-mono text-xs">{claimTarget.txHash}</span>
              </p>
              <p>
                来源 <span className="break-all font-mono text-xs">{claimTarget.fromAddress}</span>
              </p>
              <p>
                金额 <strong>{claimTarget.amount} USDT</strong>，1:1 入账为 XM。
              </p>
            </div>
            <div>
              <label className="label" htmlFor="claim-address">
                用户钱包地址
              </label>
              <input
                id="claim-address"
                className="input font-mono text-xs"
                placeholder="0x…（40 位十六进制）"
                value={userAddress}
                onChange={(event) => {
                  setUserAddress(event.target.value);
                  setFormError('');
                }}
                disabled={busy}
              />
              <p className="mt-1 text-xs text-slate-500">
                按地址精确查用户（不区分大小写）。认领后立即写入用户可用余额。
              </p>
            </div>
            {formError ? <div className="alert-error">{formError}</div> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
