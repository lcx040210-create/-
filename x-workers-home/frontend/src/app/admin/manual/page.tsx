'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BTN_SMALL,
  BTN_SMALL_DANGER,
  ConfirmDialog,
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

interface AdminSlot {
  id: string;
  orderId: string;
  creatorUserId: string;
  status: string;
  acceptedAt: string;
  deliverDeadlineAt: string;
  deliveredAt: string | null;
  deliveryUrl: string | null;
  deliveryTweetId: string | null;
  lastReject: { reasons?: string[]; at?: string; adminId?: string } | null;
  verifySnapshot: Record<string, unknown> | null;
  manualReasons: string[];
  appealRequested: boolean;
  confirmedDeadlineAt: string | null;
  settledAt: string | null;
  survivalOverride: boolean;
  createdAt: string;
  order: {
    id: string;
    title: string;
    type: string;
    status: string;
    merchantUserId: string;
  } | null;
  creator: {
    id: string;
    address: string;
    nickname: string | null;
    status: string;
  } | null;
}

interface ManualJob {
  id: string;
  type: string;
  refId: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  nextRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  slot: AdminSlot | null;
}

interface ManualQueue {
  jobs: ManualJob[];
  appeals: AdminSlot[];
  slots: AdminSlot[];
}

const TYPE_LABEL: Record<string, string> = {
  post: '发帖',
  comment: '评论',
  quote: '引用',
};

const SLOT_STATUS_LABEL: Record<string, string> = {
  reserved: '待交付',
  verifying: '核验中',
  passed: '核验通过',
  disputed: '争议中',
  paid: '已结算',
  refunded: '已退款',
  expired: '已过期',
};

export default function AdminManualPage() {
  const [data, setData] = useState<ManualQueue>({ jobs: [], appeals: [], slots: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [retryTarget, setRetryTarget] = useState<ManualJob | null>(null);
  const [resolveTarget, setResolveTarget] = useState<{
    slot: AdminSlot;
    pass: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: queue } = await adminApi.get<ManualQueue>('/admin/manual-queue');
      setData({
        jobs: Array.isArray(queue?.jobs) ? queue.jobs : [],
        appeals: Array.isArray(queue?.appeals) ? queue.appeals : [],
        slots: Array.isArray(queue?.slots) ? queue.slots : [],
      });
    } catch (err) {
      setError(errorMessage(err, '加载人工待核队列失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 申诉 + 存活失败可能命中同一名额，按 id 合并并标注来源。 */
  const pendingSlots = useMemo(() => {
    const map = new Map<string, { slot: AdminSlot; sources: string[] }>();
    for (const slot of data.appeals) {
      if (!slot) continue;
      const entry = map.get(slot.id) ?? { slot, sources: [] };
      entry.sources.push('用户申诉');
      map.set(slot.id, entry);
    }
    for (const slot of data.slots) {
      if (!slot) continue;
      const entry = map.get(slot.id) ?? { slot, sources: [] };
      entry.sources.push('存活校验失败');
      map.set(slot.id, entry);
    }
    return Array.from(map.values());
  }, [data]);

  async function handleRetry() {
    if (!retryTarget) return;
    const target = retryTarget;
    setBusy(true);
    setError('');
    try {
      await adminApi.post(`/admin/jobs/${target.id}/retry`);
      setNotice(`核验任务已重置为待执行（类型 ${target.type}）。`);
      setRetryTarget(null);
      await load();
    } catch (err) {
      const message = errorMessage(err, '重试任务失败');
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve() {
    if (!resolveTarget) return;
    const { slot, pass } = resolveTarget;
    setBusy(true);
    setError('');
    try {
      await adminApi.post(`/admin/slots/${slot.id}/resolve-delivery`, { pass });
      setNotice(pass ? '已人工放行该交付，进入结算流程。' : '已人工驳回该交付。');
      setResolveTarget(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, '人工裁决失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="人工待核"
        description="自动核验无法判定的交付（manual）、用户申诉与存活校验失败，按证据人工放行或驳回。"
        actions={
          <button
            type="button"
            className="btn-secondary py-1.5"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            刷新
          </button>
        }
      />

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          核验任务（manual）<span className="ml-2 text-xs font-normal text-slate-500">{data.jobs.length} 条</span>
        </h2>
        <TableShell>
          <thead>
            <tr>
              <Th>任务</Th>
              <Th>关联名额 / 商单</Th>
              <Th>尝试</Th>
              <Th>最后错误</Th>
              <Th>创建时间</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <StateRow
              colSpan={6}
              loading={loading}
              empty={data.jobs.length === 0}
              emptyLabel="暂无人工核验任务。"
            />
            {!loading &&
              data.jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50/60">
                  <Td>
                    <p className="font-medium text-slate-900">{job.type}</p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">
                      job {job.id}
                    </p>
                  </Td>
                  <Td>
                    {job.slot?.order ? (
                      <>
                        <p className="max-w-[220px] truncate font-medium text-slate-800">
                          {job.slot.order.title}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {TYPE_LABEL[job.slot.order.type] ?? job.slot.order.type} · 名额{' '}
                          {job.slot.status}
                        </p>
                        {job.slot.deliveryUrl ? (
                          <a
                            href={job.slot.deliveryUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="mt-0.5 block max-w-[220px] truncate text-[11px] text-indigo-600 hover:underline"
                          >
                            {job.slot.deliveryUrl}
                          </a>
                        ) : null}
                      </>
                    ) : (
                      <span className="break-all font-mono text-[11px] text-slate-500">
                        slot {job.refId}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="tabular-nums text-slate-700">{job.attempts}</span>
                  </Td>
                  <Td>
                    <p className="max-w-[220px] break-words text-xs text-rose-600">
                      {job.lastError || '—'}
                    </p>
                    {job.payload ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-slate-500">
                          payload
                        </summary>
                        <pre className="mt-1 max-w-[260px] overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[10px] text-slate-600">
                          {JSON.stringify(job.payload, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap text-xs text-slate-600">
                      {formatDateTime(job.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    <button
                      type="button"
                      className={BTN_SMALL}
                      disabled={busy}
                      onClick={() => setRetryTarget(job)}
                    >
                      重试
                    </button>
                  </Td>
                </tr>
              ))}
          </tbody>
        </TableShell>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          待人工裁决名额
          <span className="ml-2 text-xs font-normal text-slate-500">
            {pendingSlots.length} 个
          </span>
        </h2>
        <TableShell>
          <thead>
            <tr>
              <Th>商单</Th>
              <Th>接单方</Th>
              <Th>交付链接</Th>
              <Th>触发原因</Th>
              <Th>状态</Th>
              <Th>时间</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <StateRow
              colSpan={7}
              loading={loading}
              empty={pendingSlots.length === 0}
              emptyLabel="暂无待人工裁决的名额。"
            />
            {!loading &&
              pendingSlots.map(({ slot, sources }) => {
                const canResolve = slot.status === 'verifying' || slot.status === 'reserved';
                return (
                  <tr key={slot.id} className="hover:bg-slate-50/60">
                    <Td>
                      <p className="max-w-[200px] truncate font-medium text-slate-900">
                        {slot.order?.title ?? '—'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {slot.order ? (TYPE_LABEL[slot.order.type] ?? slot.order.type) : ''}
                        {slot.orderId ? ` · ${slot.orderId.slice(0, 8)}…` : ''}
                      </p>
                    </Td>
                    <Td>
                      <p className="text-slate-800">{slot.creator?.nickname || '匿名'}</p>
                      <p className="mt-0.5 max-w-[200px] break-all font-mono text-[10px] text-slate-500">
                        {slot.creator?.address ?? slot.creatorUserId}
                      </p>
                    </Td>
                    <Td>
                      {slot.deliveryUrl ? (
                        <a
                          href={slot.deliveryUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="block max-w-[200px] break-all text-xs text-indigo-600 hover:underline"
                        >
                          {slot.deliveryUrl}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">未交付</span>
                      )}
                      {slot.deliveredAt ? (
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          交付于 {formatDateTime(slot.deliveredAt)}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      <div className="flex max-w-[180px] flex-wrap gap-1">
                        {sources.map((source) => (
                          <Pill key={source} tone="amber">
                            {source}
                          </Pill>
                        ))}
                        {slot.manualReasons.map((reason) => (
                          <Pill key={reason} tone="slate">
                            {reason}
                          </Pill>
                        ))}
                        {slot.lastReject?.reasons?.length ? (
                          <Pill tone="red">上次驳回 {slot.lastReject.reasons.length} 项</Pill>
                        ) : null}
                      </div>
                      {slot.lastReject?.reasons?.length ? (
                        <p className="mt-1 max-w-[180px] text-[11px] leading-4 text-rose-600">
                          {slot.lastReject.reasons.join('；')}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      <Pill tone={slot.status === 'verifying' ? 'sky' : 'amber'}>
                        {SLOT_STATUS_LABEL[slot.status] ?? slot.status}
                      </Pill>
                      {slot.survivalOverride ? (
                        <p className="mt-1 text-[10px] text-slate-400">已人工放行过</p>
                      ) : null}
                    </Td>
                    <Td>
                      <p className="whitespace-nowrap text-xs text-slate-600">
                        交付截止 {formatDateTime(slot.deliverDeadlineAt)}
                      </p>
                      <p className="mt-0.5 whitespace-nowrap text-[11px] text-slate-400">
                        接单 {formatDateTime(slot.acceptedAt)}
                      </p>
                    </Td>
                    <Td>
                      {canResolve ? (
                        <div className="flex flex-col items-start gap-1.5">
                          <button
                            type="button"
                            className={BTN_SMALL}
                            disabled={busy}
                            onClick={() => setResolveTarget({ slot, pass: true })}
                          >
                            放行
                          </button>
                          <button
                            type="button"
                            className={BTN_SMALL_DANGER}
                            disabled={busy}
                            onClick={() => setResolveTarget({ slot, pass: false })}
                          >
                            驳回
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">状态不可裁决</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
          </tbody>
        </TableShell>
      </section>

      <ConfirmDialog
        open={!!retryTarget}
        title="重试核验任务？"
        busy={busy}
        confirmLabel="确认重试"
        onCancel={() => {
          if (!busy) setRetryTarget(null);
        }}
        onConfirm={() => void handleRetry()}
        description={
          retryTarget ? (
            <div className="space-y-2">
              <p>
                任务 <span className="font-mono text-xs">{retryTarget.id}</span> 将重置为
                pending、尝试次数清零并立即重新排队，不会改动资金。
              </p>
              {error ? <div className="alert-error">{error}</div> : null}
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!resolveTarget}
        title={resolveTarget?.pass ? '确认放行该交付？' : '确认驳回该交付？'}
        danger={!resolveTarget?.pass}
        busy={busy}
        confirmLabel={resolveTarget?.pass ? '确认放行' : '确认驳回'}
        onCancel={() => {
          if (!busy) setResolveTarget(null);
        }}
        onConfirm={() => void handleResolve()}
        description={
          resolveTarget ? (
            <div className="space-y-1">
              <p>
                商单：{resolveTarget.slot.order?.title ?? resolveTarget.slot.orderId}
              </p>
              <p>
                接单方：{resolveTarget.slot.creator?.nickname || '匿名'}（
                {resolveTarget.slot.creator?.address ?? resolveTarget.slot.creatorUserId}）
              </p>
              {resolveTarget.pass ? (
                <p className="text-emerald-700">
                  放行后视为核验通过，进入结算/放款流程；已过确认期会直接放款给接单方。
                </p>
              ) : (
                <p className="text-rose-600">
                  驳回后名额保留待交付状态，申诉关闭并记录人工驳回原因，不会放款。
                </p>
              )}
              {error ? <div className="alert-error">{error}</div> : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
