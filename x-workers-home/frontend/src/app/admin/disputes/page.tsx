'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ConfirmDialog,
  FilterTabs,
  PageHeader,
  Pill,
  type PillTone,
} from '@/components/admin/ui';
import adminApi from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';

type DisputeStatus = 'open' | 'resolved_payout' | 'resolved_refund' | 'resolved_clawback';
type Ruling = 'payout' | 'refund' | 'clawback';

interface EvidenceEntry {
  by: string;
  role: 'merchant' | 'creator';
  statement: string;
  at: string;
}

interface AdminDispute {
  id: string;
  slotId: string;
  orderId: string;
  raisedBy: 'merchant' | 'creator';
  kind: 'quality' | 'deletion';
  statement: string;
  evidence: EvidenceEntry[];
  status: DisputeStatus;
  ruling: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  arbiterMeta: Record<string, unknown>;
  createdAt: string;
  order: {
    id: string;
    title: string;
    status: string;
    merchantUserId: string;
    priceXm: string;
  } | null;
  slot: {
    id: string;
    creatorUserId: string;
    status: string;
    deliveryUrl: string | null;
  } | null;
}

const STATUS_LABEL: Record<DisputeStatus, string> = {
  open: '待裁决',
  resolved_payout: '已裁决 · 放款',
  resolved_refund: '已裁决 · 退款',
  resolved_clawback: '已裁决 · 追回',
};

const STATUS_TONE: Record<DisputeStatus, PillTone> = {
  open: 'amber',
  resolved_payout: 'green',
  resolved_refund: 'sky',
  resolved_clawback: 'red',
};

const KIND_LABEL: Record<AdminDispute['kind'], string> = {
  quality: '质量争议',
  deletion: '删帖举报',
};

const RAISED_BY_LABEL: Record<AdminDispute['raisedBy'], string> = {
  merchant: '商家',
  creator: '接单方',
};

const RULING_OPTIONS: Array<{ value: Ruling; label: string; hint: string }> = [
  { value: 'payout', label: '放款（payout）', hint: '支持接单方，按订单价放款 / 补发' },
  { value: 'refund', label: '退款（refund）', hint: '支持商家，托管退回商家' },
  {
    value: 'clawback',
    label: '追回（clawback）',
    hint: '删帖追回：从接单方已放款中追回',
  },
];

export default function AdminDisputesPage() {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [rows, setRows] = useState<AdminDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get<AdminDispute[]>('/admin/disputes', {
        params: { status: filter },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, '加载争议列表失败'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="争议裁决"
        description="阅读双方陈述与证据后裁决：放款给接单方、退款给商家，或删除追回。裁决会立即产生资金动作。"
        actions={
          <>
            <FilterTabs
              value={filter}
              options={[
                { value: 'open', label: '待裁决' },
                { value: 'all', label: '全部' },
              ]}
              busy={loading}
              onChange={(value) => setFilter(value as 'open' | 'all')}
            />
            <button
              type="button"
              className="btn-secondary py-1.5"
              onClick={() => void load()}
              disabled={loading}
            >
              刷新
            </button>
          </>
        }
      />

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      {loading ? (
        <p className="text-sm text-slate-500">加载中…</p>
      ) : rows.length === 0 ? (
        <div className="card text-sm text-slate-500">暂无争议。</div>
      ) : (
        <div className="space-y-4">
          {rows.map((dispute) => (
            <DisputeCard
              key={dispute.id}
              dispute={dispute}
              onResolved={(message) => {
                setNotice(message);
                void load();
              }}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DisputeCard({
  dispute,
  onResolved,
  onError,
}: {
  dispute: AdminDispute;
  onResolved: (message: string) => void;
  onError: (message: string) => void;
}) {
  // 不预选裁决方式，避免管理员顺手点过造成资金误操作。
  const [ruling, setRuling] = useState<Ruling | ''>('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const isOpen = dispute.status === 'open';
  const evidence = Array.isArray(dispute.evidence) ? dispute.evidence : [];
  const selected = RULING_OPTIONS.find((option) => option.value === ruling);

  async function handleResolve() {
    if (!ruling) {
      setFormError('请先选择裁决方式');
      setConfirming(false);
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await adminApi.post(`/admin/disputes/${dispute.id}/resolve`, {
        ruling,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setConfirming(false);
      onResolved(`争议已裁决：${selected?.label ?? ruling}。`);
    } catch (err) {
      const message = errorMessage(err, '争议裁决失败');
      setFormError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={STATUS_TONE[dispute.status]}>{STATUS_LABEL[dispute.status]}</Pill>
            <Pill tone={dispute.kind === 'deletion' ? 'red' : 'indigo'}>
              {KIND_LABEL[dispute.kind] ?? dispute.kind}
            </Pill>
            <Pill tone="slate">发起：{RAISED_BY_LABEL[dispute.raisedBy] ?? dispute.raisedBy}</Pill>
          </div>
          <h2 className="mt-2 text-base font-semibold text-slate-900">
            {dispute.order?.title ?? `订单 ${dispute.orderId}`}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            订单 {dispute.orderId} · 名额 {dispute.slotId} · 发起于{' '}
            {formatDateTime(dispute.createdAt)}
            {dispute.order ? ` · 单价 ${dispute.order.priceXm} XM` : ''}
          </p>
        </div>
        {dispute.slot?.deliveryUrl ? (
          <a
            href={dispute.slot.deliveryUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="max-w-[260px] break-all text-xs text-indigo-600 hover:underline"
          >
            查看交付推文 ↗
          </a>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-800">争议陈述</h3>
        <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          {dispute.statement || '（无陈述）'}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-800">
          证据与回应 <span className="text-xs font-normal text-slate-500">{evidence.length} 条</span>
        </h3>
        {evidence.length === 0 ? (
          <p className="mt-1 text-sm text-slate-400">暂无证据。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {evidence.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="rounded-lg border border-slate-200 p-3">
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Pill tone={entry.role === 'merchant' ? 'violet' : 'sky'}>
                    {RAISED_BY_LABEL[entry.role] ?? entry.role}
                  </Pill>
                  <span>{formatDateTime(entry.at)}</span>
                  <span className="break-all font-mono text-[10px] text-slate-400">
                    {entry.by}
                  </span>
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                  {entry.statement}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dispute.status !== 'open' ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-medium">{STATUS_LABEL[dispute.status]}</p>
          {dispute.ruling ? <p className="mt-1 whitespace-pre-wrap">{dispute.ruling}</p> : null}
          <p className="mt-1 text-xs text-slate-500">
            裁决人 {dispute.resolvedBy ?? '—'} · {formatDateTime(dispute.resolvedAt)}
          </p>
        </div>
      ) : (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-medium text-slate-800">裁决</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {RULING_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
                  ruling === option.value
                    ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name={`ruling-${dispute.id}`}
                  className="mr-1.5 align-middle"
                  checked={ruling === option.value}
                  onChange={() => setRuling(option.value)}
                  disabled={busy}
                />
                <span className="font-medium">{option.label}</span>
                <span className="mt-1 block text-xs text-slate-500">{option.hint}</span>
              </label>
            ))}
          </div>

          <div>
            <label className="label" htmlFor={`note-${dispute.id}`}>
              裁决备注（可选，写入裁决记录）
            </label>
            <textarea
              id={`note-${dispute.id}`}
              className="input min-h-[72px] resize-y"
              placeholder="例如：核验快照显示关键词缺失，判退款；或双方各让一步的处理说明。"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
            />
          </div>

          {formError ? <div className="alert-error">{formError}</div> : null}

          <button
            type="button"
            className="btn-primary"
            disabled={busy || !ruling}
            onClick={() => {
              setFormError('');
              setConfirming(true);
            }}
          >
            {ruling ? '提交裁决…' : '请先选择裁决方式'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="确认执行裁决？"
        danger
        busy={busy}
        confirmLabel="确认裁决"
        onCancel={() => {
          if (!busy) setConfirming(false);
        }}
        onConfirm={() => void handleResolve()}
        description={
          <div className="space-y-1">
            <p>
              裁决方式：<strong>{selected?.label ?? ruling}</strong>
            </p>
            <p className="text-xs text-slate-500">{selected?.hint}</p>
            <p>备注：{note.trim() || '（无）'}</p>
            <p className="text-rose-600">
              裁决会立即产生资金动作且不可撤销，请确认已阅读双方陈述与证据。
            </p>
            {formError ? <div className="alert-error">{formError}</div> : null}
          </div>
        }
      />
    </section>
  );
}
