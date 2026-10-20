'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api, { AuthUser, errorMessage, getAccessToken } from '@/lib/api';
import { MICRO, parseXm, withdrawalPreview } from '@/lib/format';
import { formatDateTime } from '@/lib/orders';

/* ------------------------------ 数据类型 ------------------------------ */

interface LedgerEntryView {
  id: string;
  kind: string;
  amountXm: string;
  availableDeltaXm: string;
  frozenDeltaXm: string;
  refType: string;
  refId: string;
  createdAt: string;
}

interface LedgerMineView {
  availableXm: string;
  frozenXm: string;
  entries: LedgerEntryView[];
}

interface DepositRecord {
  id: string;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  userId: string | null;
  amount: string;
  amountMicro: string;
  status: string;
  blockNumber: number;
  createdAt: string;
}

type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected';

interface WithdrawalRecord {
  id: string;
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
  isFirst: boolean;
}

/* ------------------------------ 文案 ------------------------------ */

const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  credited: '已到账',
  unmatched: '待匹配',
};

const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  pending: '审核中',
  approved: '已审核',
  paid: '已打款',
  rejected: '已驳回',
};

const WITHDRAWAL_STATUS_STYLES: Record<WithdrawalStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const LEDGER_KIND_LABEL: Record<string, string> = {
  deposit_credit: '充值到账',
  order_freeze: '发单冻结',
  order_refund: '订单退款',
  posting_fee: '发单费',
  slot_payout: '任务收入',
  completion_fee: '完成费',
  withdrawal_hold: '提现冻结',
  withdrawal_reject: '提现驳回',
  withdrawal_paid: '提现打款',
  withdrawal_fee: '提现手续费',
  referral_rebate: '邀请返佣',
  forfeit: '账号没收',
  penalty_compensation: '违约补偿',
  deletion_clawback: '删帖追回',
};

function withdrawalError(raw: string): string {
  const text = raw.trim();
  if (!text) return '请输入提现金额';
  let micro: bigint;
  try {
    micro = parseXm(text);
  } catch {
    return '请输入合法的提现金额';
  }
  if (micro <= 0n) return '请输入合法的提现金额';
  if (micro < 50n * MICRO) return '最低提现 50 XM';
  if (micro % (10n * MICRO) !== 0n) return '提现金额必须是 10 XM 的整数倍';
  return '';
}

/* ------------------------------ 页面 ------------------------------ */

export default function WalletPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [me, setMe] = useState<AuthUser | null>(null);
  const [ledger, setLedger] = useState<LedgerMineView | null>(null);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);

  const loadAll = useCallback(async () => {
    const [meRes, ledgerRes, depositRes, withdrawalRes] = await Promise.all([
      api.get<AuthUser>('/auth/me'),
      api.get<LedgerMineView>('/ledger/mine'),
      api.get<DepositRecord[]>('/deposits/mine'),
      api.get<WithdrawalRecord[]>('/withdrawals/mine'),
    ]);
    setMe(meRes.data);
    setLedger(ledgerRes.data);
    setDeposits(depositRes.data ?? []);
    setWithdrawals(withdrawalRes.data ?? []);
  }, []);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    setReady(true);
    let cancelled = false;
    loadAll()
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, '加载钱包信息失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, loadAll]);

  const handleWithdrawn = useCallback(
    async (message: string) => {
      setNotice(message);
      setError('');
      try {
        await loadAll();
      } catch (err) {
        setError(errorMessage(err, '刷新钱包信息失败'));
      }
    },
    [loadAll],
  );

  if (!ready) {
    return <p className="text-sm text-slate-500">正在加载…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">钱包</h1>
        <p className="mt-1 text-sm text-slate-600">
          充值 BSC USDT(BEP20)，余额用于发单托管与提现。
        </p>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}
      {loading ? <p className="text-sm text-slate-500">正在加载钱包数据…</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white shadow-sm">
          <p className="text-sm text-indigo-100">可用余额</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">
            {ledger?.availableXm ?? '0'}
            <span className="ml-2 text-base font-normal text-indigo-100">XM</span>
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-500">冻结余额</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
            {ledger?.frozenXm ?? '0'}
            <span className="ml-2 text-base font-normal text-slate-500">XM</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            提现处理中或托管中的金额会体现在这里。
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DepositPanel address={me?.address ?? null} deposits={deposits} />
        <WithdrawPanel
          availableXm={ledger?.availableXm ?? '0'}
          records={withdrawals}
          onWithdrawn={handleWithdrawn}
        />
      </div>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">资金流水</h2>
          <span className="text-xs text-slate-500">最近 50 条</span>
        </div>
        {ledger && ledger.entries.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {ledger.entries.map((entry) => {
              const negative = entry.amountXm.startsWith('-');
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-800">
                      {LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`font-semibold tabular-nums ${
                      entry.amountXm === '0'
                        ? 'text-slate-500'
                        : negative
                          ? 'text-rose-600'
                          : 'text-emerald-700'
                    }`}
                  >
                    {negative || entry.amountXm === '0' ? '' : '+'}
                    {entry.amountXm} XM
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">暂无流水。</p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ 充值 ------------------------------ */

function DepositPanel({
  address,
  deposits,
}: {
  address: string | null;
  deposits: DepositRecord[];
}) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!address || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默降级，用户可手动选择复制。
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">充值</h2>
        <p className="mt-1 text-xs text-slate-500">
          仅从绑定钱包转 BSC USDT(BEP20)，1:1 到账，最低 10 U。
        </p>
      </div>

      <div className="flex flex-col items-start gap-4 sm:flex-row">
        {address ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <QRCodeSVG value={address} size={132} level="M" />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-slate-500">绑定钱包地址</p>
          <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">
            {address ?? '未绑定钱包'}
          </p>
          {address ? (
            <button type="button" className="btn-secondary py-1" onClick={() => void copyAddress()}>
              {copied ? '已复制' : '复制地址'}
            </button>
          ) : null}
          <p className="text-xs leading-5 text-slate-500">
            请务必使用当前绑定的钱包转入；其他地址转入可能无法自动匹配入账。
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-800">充值记录</h3>
        {deposits.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">暂无充值记录。</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {deposits.map((deposit) => (
              <li key={deposit.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 tabular-nums">
                    {deposit.amount} USDT
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDateTime(deposit.createdAt)} ·{' '}
                    {DEPOSIT_STATUS_LABEL[deposit.status] ?? deposit.status}
                  </p>
                  {deposit.txHash ? (
                    <a
                      href={`https://bscscan.com/tx/${deposit.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block break-all text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                    >
                      {deposit.txHash}
                    </a>
                  ) : null}
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    deposit.status === 'credited'
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : 'bg-amber-50 text-amber-700 ring-amber-200'
                  }`}
                >
                  {DEPOSIT_STATUS_LABEL[deposit.status] ?? deposit.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------ 提现 ------------------------------ */

function WithdrawPanel({
  availableXm,
  records,
  onWithdrawn,
}: {
  availableXm: string;
  records: WithdrawalRecord[];
  onWithdrawn: (message: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

  const inlineError = amount.trim() ? withdrawalError(amount) : '';
  const preview = useMemo(() => {
    if (!amount.trim() || inlineError) return null;
    try {
      return withdrawalPreview(amount.trim());
    } catch {
      return null;
    }
  }, [amount, inlineError]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    setSuccess('');
    const validation = withdrawalError(amount);
    if (validation) {
      setFormError(validation);
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post<{ payoutXm: string }>('/withdrawals/request', {
        amountXm: amount.trim(),
      });
      setAmount('');
      setSuccess(`提现申请已提交，到账 ${data.payoutXm} XM（已扣除 10% 手续费）`);
      await onWithdrawn('提现申请已提交');
    } catch (err) {
      setFormError(errorMessage(err, '提现申请失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">提现</h2>
        <p className="mt-1 text-xs text-slate-500">
          最低 50 XM，金额须为 10 的整数倍，手续费 10%。当前可用 {availableXm} XM。
        </p>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit}>
        <div>
          <label className="label" htmlFor="withdraw-amount">
            提现金额（XM）
          </label>
          <input
            id="withdraw-amount"
            className="input"
            inputMode="numeric"
            placeholder="例如 50"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setFormError('');
              setSuccess('');
            }}
            disabled={busy}
          />
        </div>

        {inlineError ? (
          <p className="text-xs text-rose-600">{inlineError}</p>
        ) : preview ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div>
              <p className="text-xs text-slate-500">手续费（10%）</p>
              <p className="mt-0.5 font-semibold text-amber-700">{preview.fee} XM</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">预计到账</p>
              <p className="mt-0.5 font-semibold text-emerald-700">{preview.payout} XM</p>
            </div>
          </div>
        ) : null}

        {formError ? <div className="alert-error">{formError}</div> : null}
        {success ? <div className="alert-info">{success}</div> : null}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? '提交中…' : '申请提现'}
        </button>
      </form>

      <div>
        <h3 className="text-sm font-medium text-slate-800">提现记录</h3>
        {records.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">暂无提现记录。</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {records.map((record) => (
              <li key={record.id} className="space-y-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900 tabular-nums">
                    {record.amountXm} XM
                  </p>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${WITHDRAWAL_STATUS_STYLES[record.status]}`}
                  >
                    {WITHDRAWAL_STATUS_LABEL[record.status]}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {formatDateTime(record.createdAt)} · 手续费 {record.feeXm} XM · 到账{' '}
                  {record.payoutXm} XM
                </p>
                {record.txHash ? (
                  <p className="break-all text-xs text-slate-500">Tx {record.txHash}</p>
                ) : null}
                {record.status === 'rejected' && record.rejectReason ? (
                  <p className="text-xs text-rose-600">驳回原因：{record.rejectReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
