'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Pill } from '@/components/admin/ui';
import adminApi from '@/lib/admin-api';
import { formatMicro } from '@/lib/admin-format';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';

interface ReconciliationIncome {
  postingFee: string;
  completionFee: string;
  withdrawalFee: string;
  forfeit: string;
  rebatePaid: string;
  compensationPaid: string;
  net: string;
}

interface Reconciliation {
  totalXm: string;
  walletUsdtMicro: string;
  requiredMicro: string;
  deficitMicro: string;
  status: 'ok' | 'deficit';
  income: ReconciliationIncome;
  accounts: { escrowAvailable: string; platformIncome: string };
}

const INCOME_ITEMS: Array<{
  key: keyof ReconciliationIncome;
  label: string;
  expense?: boolean;
}> = [
  { key: 'postingFee', label: '发单费' },
  { key: 'completionFee', label: '完成费' },
  { key: 'withdrawalFee', label: '提现手续费' },
  { key: 'forfeit', label: '没收' },
  { key: 'rebatePaid', label: '邀请返佣（支出）', expense: true },
  { key: 'compensationPaid', label: '违约补偿（支出）', expense: true },
];

export default function AdminReconciliationPage() {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: snapshot } = await adminApi.get<Reconciliation>('/admin/reconciliation');
      setData(snapshot);
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(
        errorMessage(err, '对账快照计算失败：请检查链上 RPC 与数据库连接（详见后端日志）'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const deficit = data?.status === 'deficit';

  return (
    <div className="space-y-4">
      <PageHeader
        title="对账"
        description="平台 XM 总量与链上 USDT 覆盖率巡检（后端每 30 分钟一次，本页按需重新计算）。"
        actions={
          <>
            {updatedAt ? (
              <span className="text-xs text-slate-500">
                快照 {formatDateTime(updatedAt)}
              </span>
            ) : null}
            <button
              type="button"
              className="btn-secondary py-1.5"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </>
        }
      />

      {error ? <div className="alert-error">{error}</div> : null}

      {loading && !data ? <p className="text-sm text-slate-500">正在计算对账快照…</p> : null}

      {data ? (
        <>
          <div
            className={`rounded-2xl border p-5 ${
              deficit
                ? 'border-red-300 bg-red-50'
                : 'border-emerald-200 bg-emerald-50'
            }`}
            role="status"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p
                  className={`text-base font-semibold ${
                    deficit ? 'text-red-800' : 'text-emerald-800'
                  }`}
                >
                  {deficit ? '对账缺口：平台钱包 USDT 不足' : '对账正常：钱包余额覆盖应付下限'}
                </p>
                <p className={`mt-1 text-sm ${deficit ? 'text-red-700' : 'text-emerald-700'}`}>
                  {deficit
                    ? `当前缺口 ${formatMicro(data.deficitMicro)} XM，请尽快向平台钱包补充 USDT(BEP20)。`
                    : '平台钱包余额 ≥ 应付下限（XM 总量的 90% + 未完成提现实付额）。'}
                </p>
              </div>
              <Pill tone={deficit ? 'red' : 'green'}>{deficit ? 'DEFICIT' : 'OK'}</Pill>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="全平台 XM 总量"
              value={data.totalXm}
              unit="XM"
              hint="所有账户 available + frozen（后端已是十进制串）"
            />
            <MetricCard
              label="应付下限"
              value={formatMicro(data.requiredMicro)}
              unit="XM"
              hint="总量 90% + 待打款提现实付"
            />
            <MetricCard
              label="平台钱包余额"
              value={formatMicro(data.walletUsdtMicro)}
              unit="USDT"
              hint="BSC USDT(BEP20)，与 XM 1:1"
            />
            <MetricCard
              label="缺口"
              value={formatMicro(data.deficitMicro)}
              unit="XM"
              tone={deficit ? 'red' : 'green'}
              hint="max(0, 应付下限 − 钱包余额)"
            />
          </div>

          <section className="card space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">收入分项</h2>
              <p className="mt-1 text-xs text-slate-500">
                来自 platform_income 账户流水净额；支出现以正数展示，net = 收入项 − 支出项。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">项目</th>
                    <th className="py-2 pr-3 text-right font-medium">金额（XM）</th>
                    <th className="py-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {INCOME_ITEMS.map((item) => (
                    <tr key={item.key}>
                      <td className="py-2 pr-3 text-slate-700">{item.label}</td>
                      <td
                        className={`py-2 pr-3 text-right font-mono tabular-nums ${
                          item.expense ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {formatMicro(data.income[item.key])}
                      </td>
                      <td className="py-2 text-xs text-slate-400">
                        {item.expense ? '平台向用户支出，计入净额扣减' : '平台收入'}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200">
                    <td className="py-2.5 pr-3 font-semibold text-slate-900">净收入</td>
                    <td
                      className={`py-2.5 pr-3 text-right font-mono font-semibold tabular-nums ${
                        data.income.net.startsWith('-') ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatMicro(data.income.net)}
                    </td>
                    <td className="py-2.5 text-xs text-slate-400">收入 − 支出</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">平台账户余额</h2>
              <p className="mt-1 text-xs text-slate-500">
                账户余额单位为 micro-XM，已转换为十进制 XM 展示。
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-slate-500">托管账户（escrow）</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                  {formatMicro(data.accounts.escrowAvailable)}
                  <span className="ml-1 text-sm font-normal text-slate-500">XM</span>
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-slate-500">平台收入账户（platform_income）</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                  {formatMicro(data.accounts.platformIncome)}
                  <span className="ml-1 text-sm font-normal text-slate-500">XM</span>
                </p>
              </div>
            </div>
          </section>

          <p className="text-xs leading-5 text-slate-400">
            口径说明：totalXm 为十进制 XM 串；walletUsdtMicro / requiredMicro /
            deficitMicro / income.* / accounts.* 均为 micro 整数串。本页统一用 BigInt
            转换后展示，不做浮点运算。对账巡检由后端每 30 分钟执行，deficit 时会写服务端告警日志。
          </p>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone?: 'default' | 'red' | 'green';
}) {
  const valueClass =
    tone === 'red' ? 'text-rose-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="card p-5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1.5 break-all text-2xl font-bold tabular-nums ${valueClass}`}>
        {value}
        <span className="ml-1 text-sm font-normal text-slate-500">{unit}</span>
      </p>
      <p className="mt-1 text-[11px] leading-4 text-slate-400">{hint}</p>
    </div>
  );
}
