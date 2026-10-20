'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BTN_DANGER,
  BTN_SMALL,
  ConfirmDialog,
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

type OrderType = 'post' | 'comment' | 'quote';
type OrderStatus = 'recruiting' | 'closed' | 'completed';
type SlotStatus =
  | 'reserved'
  | 'verifying'
  | 'passed'
  | 'disputed'
  | 'paid'
  | 'refunded'
  | 'expired';

interface MerchantView {
  id: string;
  address: string;
  nickname: string | null;
  status: string;
}

interface AdminOrderSummary {
  id: string;
  type: OrderType;
  title: string;
  priceXm: string;
  feeXm: string;
  escrowXm: string;
  slotsTotal: number;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
  closedAt: string | null;
  merchant: MerchantView | null;
}

interface AdminOrderSlot {
  id: string;
  orderId: string;
  creatorUserId: string;
  creator: MerchantView | null;
  status: SlotStatus;
  acceptedAt: string;
  deliverDeadlineAt: string;
  deliveredAt: string | null;
  deliveryUrl: string | null;
  deliveryTweetId: string | null;
  lastReject: { reasons?: string[]; at?: string } | null;
  verifySnapshot: Record<string, unknown> | null;
  manualReasons: string[];
  appealRequested: boolean;
  confirmedDeadlineAt: string | null;
  settledAt: string | null;
  survivalOverride: boolean;
  createdAt: string;
}

interface AdminOrderDispute {
  id: string;
  slotId: string;
  kind: string;
  status: string;
  statement: string;
  evidence: Array<{ by: string; role: string; statement: string; at: string }>;
  ruling: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface AdminOrderDetail extends AdminOrderSummary {
  brief: string;
  requirements: {
    keywords?: string[];
    hashtags?: string[];
    mentions?: string[];
    links?: string[];
    minChars?: number;
  } | null;
  targetTweetUrl: string | null;
  feeEarned: boolean;
  slots: AdminOrderSlot[];
  disputes: AdminOrderDispute[];
}

interface OrderListResult {
  items: AdminOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
}

interface PenalizeResult {
  id: string;
  status: string;
  escrowForfeitedXm: string;
  merchantForfeitedXm: string;
  compensated: Array<{ slotId: string; userId: string; amountXm: string }>;
  expiredSlotIds: string[];
  suspendedUserId: string;
}

const TYPE_LABEL: Record<OrderType, string> = {
  post: '发帖',
  comment: '评论',
  quote: '引用',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  recruiting: '招募中',
  closed: '已下架',
  completed: '已完成',
};

const STATUS_TONE: Record<OrderStatus, PillTone> = {
  recruiting: 'green',
  closed: 'slate',
  completed: 'indigo',
};

const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  reserved: '待交付',
  verifying: '核验中',
  passed: '核验通过',
  disputed: '争议中',
  paid: '已结算',
  refunded: '已退款',
  expired: '已过期',
};

const SLOT_STATUS_TONE: Record<SlotStatus, PillTone> = {
  reserved: 'amber',
  verifying: 'sky',
  passed: 'green',
  disputed: 'red',
  paid: 'indigo',
  refunded: 'slate',
  expired: 'slate',
};

const DISPUTE_STATUS_LABEL: Record<string, string> = {
  open: '待裁决',
  resolved_payout: '已裁决 · 放款',
  resolved_refund: '已裁决 · 退款',
  resolved_clawback: '已裁决 · 追回',
};

interface AppliedQuery {
  q: string;
  type: '' | OrderType;
  status: '' | OrderStatus;
  page: number;
}

export default function AdminOrdersPage() {
  const [qInput, setQInput] = useState('');
  const [typeInput, setTypeInput] = useState<'' | OrderType>('');
  const [statusInput, setStatusInput] = useState<'' | OrderStatus>('');
  const [applied, setApplied] = useState<AppliedQuery>({ q: '', type: '', status: '', page: 1 });

  const [result, setResult] = useState<OrderListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [penalizeOpen, setPenalizeOpen] = useState(false);
  const [penalizeReason, setPenalizeReason] = useState('');
  const [penalizeConfirmOpen, setPenalizeConfirmOpen] = useState(false);
  const [penalizeError, setPenalizeError] = useState('');
  const [penalizeBusy, setPenalizeBusy] = useState(false);

  const loadList = useCallback(async (query: AppliedQuery) => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string | number> = { page: query.page };
      if (query.q) params.q = query.q;
      if (query.type) params.type = query.type;
      if (query.status) params.status = query.status;
      const { data } = await adminApi.get<OrderListResult>('/admin/orders', { params });
      setResult({
        items: Array.isArray(data?.items) ? data.items : [],
        total: data?.total ?? 0,
        page: data?.page ?? query.page,
        pageSize: data?.pageSize ?? 20,
      });
    } catch (err) {
      setError(errorMessage(err, '加载订单失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList(applied);
  }, [applied, loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const { data } = await adminApi.get<AdminOrderDetail>(`/admin/orders/${id}`);
      setDetail(data);
    } catch (err) {
      setDetail(null);
      setDetailError(errorMessage(err, '加载订单详情失败'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openDetail(id: string) {
    setDetailId(id);
    setDetail(null);
    void loadDetail(id);
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setApplied({
      q: qInput.trim(),
      type: typeInput,
      status: statusInput,
      page: 1,
    });
  }

  function openPenalize() {
    setPenalizeReason('');
    setPenalizeError('');
    setPenalizeOpen(true);
  }

  function nextToConfirm() {
    if (!penalizeReason.trim()) {
      setPenalizeError('请填写罚则原因（会通知商家并写入审计日志）');
      return;
    }
    setPenalizeError('');
    setPenalizeOpen(false);
    setPenalizeConfirmOpen(true);
  }

  async function executePenalize() {
    if (!detail) return;
    setPenalizeBusy(true);
    setPenalizeError('');
    try {
      const { data } = await adminApi.post<PenalizeResult>(
        `/admin/orders/${detail.id}/penalize`,
        { reason: penalizeReason.trim() },
      );
      setPenalizeConfirmOpen(false);
      setPenalizeOpen(false);
      setNotice(
        `罚则已执行：托管没收 ${data.escrowForfeitedXm} XM，商家余额没收 ${data.merchantForfeitedXm} XM，` +
          `补发 ${data.compensated.length} 个名额，关闭 ${data.expiredSlotIds.length} 个未交付名额，商家已封禁。`,
      );
      await loadDetail(detail.id);
      await loadList(applied);
    } catch (err) {
      const message = errorMessage(err, '执行罚则失败');
      setPenalizeError(message);
      setError(message);
    } finally {
      setPenalizeBusy(false);
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="订单抽查"
        description="按标题 / 订单 ID / 商家地址搜索；查看交付链接、核验快照与争议，对违规单执行罚则。"
      />

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
        onSubmit={handleSearch}
      >
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="order-q">
            关键词
          </label>
          <input
            id="order-q"
            className="input"
            placeholder="标题 / 订单 ID / 商家地址"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="order-type">
            类型
          </label>
          <select
            id="order-type"
            className="input"
            value={typeInput}
            onChange={(event) => setTypeInput(event.target.value as '' | OrderType)}
          >
            <option value="">全部</option>
            <option value="post">发帖</option>
            <option value="comment">评论</option>
            <option value="quote">引用</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="order-status">
            状态
          </label>
          <select
            id="order-status"
            className="input"
            value={statusInput}
            onChange={(event) => setStatusInput(event.target.value as '' | OrderStatus)}
          >
            <option value="">全部</option>
            <option value="recruiting">招募中</option>
            <option value="closed">已下架</option>
            <option value="completed">已完成</option>
          </select>
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '查询中…' : '搜索'}
        </button>
      </form>

      <TableShell>
        <thead>
          <tr>
            <Th>商单</Th>
            <Th>类型</Th>
            <Th>状态</Th>
            <Th>单价 / 托管</Th>
            <Th>名额</Th>
            <Th>商家</Th>
            <Th>创建时间</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <StateRow
            colSpan={8}
            loading={loading}
            empty={(result?.items.length ?? 0) === 0}
            emptyLabel="没有符合条件的订单。"
          />
          {!loading &&
            result?.items.map((order) => (
              <tr
                key={order.id}
                className={`hover:bg-slate-50/60 ${detailId === order.id ? 'bg-indigo-50/40' : ''}`}
              >
                <Td>
                  <p className="max-w-[240px] truncate font-medium text-slate-900">{order.title}</p>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">
                    {order.id}
                  </p>
                </Td>
                <Td>
                  <Pill tone="indigo">{TYPE_LABEL[order.type] ?? order.type}</Pill>
                </Td>
                <Td>
                  <Pill tone={STATUS_TONE[order.status] ?? 'slate'}>
                    {STATUS_LABEL[order.status] ?? order.status}
                  </Pill>
                </Td>
                <Td>
                  <p className="whitespace-nowrap font-semibold tabular-nums text-slate-900">
                    {order.priceXm} XM
                  </p>
                  <p className="text-[11px] text-slate-500">托管 {order.escrowXm} XM</p>
                </Td>
                <Td>
                  <span className="tabular-nums text-slate-700">{order.slotsTotal}</span>
                </Td>
                <Td>
                  <p className="max-w-[140px] truncate text-slate-800">
                    {order.merchant?.nickname || '—'}
                  </p>
                  <p className="mt-0.5 max-w-[140px] truncate font-mono text-[10px] text-slate-400">
                    {order.merchant?.address ?? ''}
                  </p>
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(order.createdAt)}
                  </span>
                </Td>
                <Td>
                  <button
                    type="button"
                    className={BTN_SMALL}
                    onClick={() => openDetail(order.id)}
                  >
                    抽查详情
                  </button>
                </Td>
              </tr>
            ))}
        </tbody>
      </TableShell>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>
          共 {result?.total ?? 0} 条 · 第 {result?.page ?? applied.page} / {totalPages} 页
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary py-1.5"
            disabled={loading || applied.page <= 1}
            onClick={() => setApplied((prev) => ({ ...prev, page: prev.page - 1 }))}
          >
            上一页
          </button>
          <button
            type="button"
            className="btn-secondary py-1.5"
            disabled={loading || applied.page >= totalPages}
            onClick={() => setApplied((prev) => ({ ...prev, page: prev.page + 1 }))}
          >
            下一页
          </button>
        </div>
      </div>

      {detailId ? (
        <section className="card space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">抽查详情</p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">
                {detail?.title ?? '加载中…'}
              </h2>
              {detail ? (
                <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{detail.id}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={BTN_DANGER}
                disabled={!detail || detailLoading || penalizeBusy}
                onClick={openPenalize}
              >
                执行罚则…
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDetailId(null);
                  setDetail(null);
                  setDetailError('');
                }}
              >
                收起
              </button>
            </div>
          </div>

          {detailError ? <div className="alert-error">{detailError}</div> : null}
          {detailLoading ? <p className="text-sm text-slate-500">正在加载订单详情…</p> : null}

          {detail ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone="indigo">{TYPE_LABEL[detail.type] ?? detail.type}</Pill>
                <Pill tone={STATUS_TONE[detail.status] ?? 'slate'}>
                  {STATUS_LABEL[detail.status] ?? detail.status}
                </Pill>
                {detail.feeEarned ? <Pill tone="green">平台费已赚取</Pill> : null}
              </div>

              <dl className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="单价" value={`${detail.priceXm} XM`} />
                <DetailItem label="托管余额" value={`${detail.escrowXm} XM`} />
                <DetailItem label="名额数" value={String(detail.slotsTotal)} />
                <DetailItem label="创建时间" value={formatDateTime(detail.createdAt)} />
                <DetailItem label="招募截止" value={formatDateTime(detail.expiresAt)} />
                <DetailItem label="关闭时间" value={formatDateTime(detail.closedAt)} />
                <DetailItem
                  label="商家"
                  value={`${detail.merchant?.nickname || '—'}（${detail.merchant?.status ?? '—'}）`}
                />
                <DetailItem
                  label="商家地址"
                  value={detail.merchant?.address ?? '—'}
                  mono
                />
              </dl>

              <div className="grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-medium text-slate-800">需求描述</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {detail.brief || '—'}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-800">交付要求</h3>
                  <RequirementsView requirements={detail.requirements} />
                  {detail.targetTweetUrl ? (
                    <p className="mt-2 break-all text-xs text-slate-600">
                      目标推文：
                      <a
                        href={detail.targetTweetUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-indigo-600 hover:underline"
                      >
                        {detail.targetTweetUrl}
                      </a>
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-sm font-medium text-slate-800">
                  名额与交付 <span className="text-xs font-normal text-slate-500">{detail.slots.length} 个</span>
                </h3>
                {detail.slots.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">暂无接单。</p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {detail.slots.map((slot) => (
                      <div key={slot.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {slot.creator?.nickname || '匿名'}
                              <span className="ml-2 break-all font-mono text-[10px] font-normal text-slate-400">
                                {slot.creator?.address ?? slot.creatorUserId}
                              </span>
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              接单 {formatDateTime(slot.acceptedAt)} · 截止{' '}
                              {formatDateTime(slot.deliverDeadlineAt)}
                              {slot.deliveredAt
                                ? ` · 交付 ${formatDateTime(slot.deliveredAt)}`
                                : ''}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            <Pill tone={SLOT_STATUS_TONE[slot.status] ?? 'slate'}>
                              {SLOT_STATUS_LABEL[slot.status] ?? slot.status}
                            </Pill>
                            {slot.appealRequested ? <Pill tone="amber">申诉中</Pill> : null}
                            {slot.survivalOverride ? <Pill tone="violet">人工放行</Pill> : null}
                          </div>
                        </div>

                        {slot.deliveryUrl ? (
                          <a
                            href={slot.deliveryUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="mt-2 block break-all text-xs text-indigo-600 hover:underline"
                          >
                            交付链接：{slot.deliveryUrl}
                          </a>
                        ) : (
                          <p className="mt-2 text-xs text-slate-400">尚未交付。</p>
                        )}

                        {slot.manualReasons.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {slot.manualReasons.map((reason) => (
                              <Pill key={reason} tone="amber">
                                {reason}
                              </Pill>
                            ))}
                          </div>
                        ) : null}

                        {slot.lastReject?.reasons?.length ? (
                          <p className="mt-2 text-xs text-rose-600">
                            最近驳回：{slot.lastReject.reasons.join('；')}
                          </p>
                        ) : null}

                        {slot.verifySnapshot ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-slate-500">
                              核验快照
                            </summary>
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
                              {JSON.stringify(slot.verifySnapshot, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-sm font-medium text-slate-800">
                  争议 <span className="text-xs font-normal text-slate-500">{detail.disputes.length} 条</span>
                </h3>
                {detail.disputes.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">无争议。</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.disputes.map((dispute) => (
                      <li key={dispute.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <Pill tone={dispute.status === 'open' ? 'amber' : 'slate'}>
                            {DISPUTE_STATUS_LABEL[dispute.status] ?? dispute.status}
                          </Pill>
                          <Pill tone={dispute.kind === 'deletion' ? 'red' : 'indigo'}>
                            {dispute.kind === 'deletion' ? '删帖' : '质量'}
                          </Pill>
                          <span className="text-slate-400">{formatDateTime(dispute.createdAt)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                          {dispute.statement}
                        </p>
                        {Array.isArray(dispute.evidence) && dispute.evidence.length > 0 ? (
                          <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                            {dispute.evidence.map((entry, index) => (
                              <li key={`${entry.at}-${index}`} className="text-xs text-slate-600">
                                <span className="text-slate-400">
                                  {entry.role === 'merchant' ? '商家' : '接单方'} ·{' '}
                                  {formatDateTime(entry.at)}：
                                </span>
                                <span className="whitespace-pre-wrap">{entry.statement}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {dispute.ruling ? (
                          <p className="mt-2 text-xs text-slate-500">裁决：{dispute.ruling}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <Modal
        open={penalizeOpen}
        title="执行罚则（第 1/2 步：填写原因）"
        wide
        onClose={() => {
          if (!penalizeBusy) setPenalizeOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={penalizeBusy}
              onClick={() => setPenalizeOpen(false)}
            >
              取消
            </button>
            <button type="button" className={BTN_DANGER} onClick={nextToConfirm}>
              下一步：确认后果
            </button>
          </>
        }
      >
        {detail ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-rose-50 p-3 text-sm leading-6 text-rose-800">
              <p className="font-semibold">该操作会立即：</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>关闭商单「{detail.title}」，托管余额全额没收至平台收入；</li>
                <li>已交付名额按单价全额补发给接单方；未交付托管名额关闭；</li>
                <li>商家全部余额没收、账号封禁，未完成提现全部驳回；</li>
                <li>通知受影响接单方，并写入不可撤销的管理员审计日志。</li>
              </ul>
            </div>
            <div>
              <label className="label" htmlFor="penalize-reason">
                罚则原因（必填，会展示给商家）
              </label>
              <textarea
                id="penalize-reason"
                className="input min-h-[96px] resize-y"
                placeholder="例如：虚假商单 / 要求接单方删帖 / 恶意拖欠，附证据说明"
                value={penalizeReason}
                onChange={(event) => {
                  setPenalizeReason(event.target.value);
                  setPenalizeError('');
                }}
                disabled={penalizeBusy}
              />
            </div>
            {penalizeError ? <div className="alert-error">{penalizeError}</div> : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={penalizeConfirmOpen}
        title="最终确认：执行罚则？"
        danger
        busy={penalizeBusy}
        confirmLabel="确认执行罚则"
        onCancel={() => {
          if (!penalizeBusy) setPenalizeConfirmOpen(false);
        }}
        onConfirm={() => void executePenalize()}
        description={
          detail ? (
            <div className="space-y-1">
              <p>
                商单：<strong>{detail.title}</strong>
              </p>
              <p>原因：{penalizeReason.trim()}</p>
              <p className="text-rose-600">
                资金与账号动作不可撤销。确认已核对交付链接、核验快照与争议记录。
              </p>
              {penalizeError ? <div className="alert-error">{penalizeError}</div> : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-1 break-all text-sm text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function RequirementsView({
  requirements,
}: {
  requirements: AdminOrderDetail['requirements'];
}) {
  if (!requirements) return <p className="mt-1 text-sm text-slate-400">无特殊要求。</p>;
  const groups: Array<[string, string[] | undefined, string?]> = [
    ['关键词', requirements.keywords],
    ['话题标签', requirements.hashtags, '#'],
    ['@ 提及', requirements.mentions, '@'],
    ['要求链接', requirements.links],
  ];
  return (
    <div className="mt-1 space-y-1 text-xs text-slate-600">
      {groups.map(([label, values, prefix]) => (
        <p key={label}>
          <span className="text-slate-500">{label}：</span>
          {values && values.length > 0
            ? values
                .map((value) => (prefix && !value.startsWith(prefix) ? `${prefix}${value}` : value))
                .join('、')
            : '无'}
        </p>
      ))}
      {requirements.minChars !== undefined ? (
        <p>
          <span className="text-slate-500">字数下限：</span>≥ {requirements.minChars} 字符
        </p>
      ) : null}
    </div>
  );
}
