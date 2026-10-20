'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Countdown from '@/components/Countdown';
import RatingBadge from '@/components/RatingBadge';
import Stars from '@/components/Stars';
import { ConfirmDialog } from '@/components/admin/ui';
import api, { errorMessage, getAccessToken } from '@/lib/api';
import { feeOf, formatXm, MICRO, parseXm, payoutOf } from '@/lib/format';
import {
  formatDateTime,
  ORDER_STATUS_LABEL,
  ORDER_TYPE_LABEL,
  SLOT_STATUS_LABEL,
  type OrderStatus,
  type OrderType,
  type SlotStatus,
} from '@/lib/orders';

/* ------------------------------ 数据类型 ------------------------------ */

interface RejectInfo {
  reasons?: string[];
  at?: string;
}

interface TakenSlot {
  id: string;
  orderId: string;
  status: SlotStatus;
  acceptedAt: string;
  deliverDeadlineAt: string;
  deliveredAt: string | null;
  deliveryUrl: string | null;
  lastReject: RejectInfo | null;
  appealRequested: boolean;
  confirmedDeadlineAt: string | null;
  settledAt: string | null;
  createdAt: string;
  order: {
    id: string;
    title: string;
    type: OrderType;
    priceXm: string;
    payoutXm: string;
    status: OrderStatus;
  };
}

interface MyOrderSlot {
  id: string;
  status: SlotStatus;
  creator: { id: string; nickname: string | null; ratingGrade: string | null };
  acceptedAt: string;
  deliverDeadlineAt: string;
  deliveredAt: string | null;
  confirmedDeadlineAt: string | null;
  settledAt: string | null;
  deliveryUrl: string | null;
  lastReject: RejectInfo | null;
  appealRequested: boolean;
}

interface MyOrder {
  id: string;
  type: OrderType;
  title: string;
  priceXm: string;
  slotsTotal: number;
  escrowXm: string;
  feeEarned: boolean;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
  slots: MyOrderSlot[];
}

/* ------------------------------ 样式 ------------------------------ */

const SLOT_STATUS_STYLES: Record<SlotStatus, string> = {
  reserved: 'bg-amber-50 text-amber-700 ring-amber-200',
  verifying: 'bg-sky-50 text-sky-700 ring-sky-200',
  passed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  disputed: 'bg-rose-50 text-rose-700 ring-rose-200',
  paid: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  refunded: 'bg-slate-100 text-slate-600 ring-slate-200',
  expired: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  recruiting: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-300',
  completed: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};

const TYPE_STYLES: Record<OrderType, string> = {
  post: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  comment: 'bg-sky-50 text-sky-700 ring-sky-200',
  quote: 'bg-violet-50 text-violet-700 ring-violet-200',
};

function StatusBadge({ status }: { status: SlotStatus }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${SLOT_STATUS_STYLES[status]}`}
    >
      {SLOT_STATUS_LABEL[status]}
    </span>
  );
}

/* ------------------------------ 页面 ------------------------------ */

export default function MeTasksPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'taken' | 'posted'>('taken');
  const [slots, setSlots] = useState<TakenSlot[]>([]);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSlots = useCallback(async () => {
    const { data } = await api.get<{ items: TakenSlot[] }>('/me/slots');
    setSlots(data.items ?? []);
  }, []);

  const loadOrders = useCallback(async () => {
    const { data } = await api.get<{ items: MyOrder[] }>('/me/orders');
    setOrders(data.items ?? []);
  }, []);

  const reloadAll = useCallback(async () => {
    const results = await Promise.allSettled([loadSlots(), loadOrders()]);
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failed) {
      throw failed.reason;
    }
  }, [loadSlots, loadOrders]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    setReady(true);
    let cancelled = false;
    reloadAll()
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, '加载任务失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, reloadAll]);

  const handleChanged = useCallback(
    async (message: string) => {
      setNotice(message);
      setError('');
      try {
        await reloadAll();
      } catch (err) {
        setError(errorMessage(err, '刷新任务失败'));
      }
    },
    [reloadAll],
  );

  if (!ready) {
    return <p className="text-sm text-slate-500">正在加载…</p>;
  }

  const takenActive = slots.filter(
    (slot) => slot.status !== 'paid' && slot.status !== 'expired' && slot.status !== 'refunded',
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的任务</h1>
          <p className="mt-1 text-sm text-slate-600">
            管理接单交付、发单进度与结算操作。
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          <button
            type="button"
            className={`rounded-md px-4 py-1.5 transition ${
              tab === 'taken'
                ? 'bg-indigo-600 font-medium text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
            onClick={() => setTab('taken')}
          >
            接单{takenActive > 0 ? `（${takenActive}）` : ''}
          </button>
          <button
            type="button"
            className={`rounded-md px-4 py-1.5 transition ${
              tab === 'posted'
                ? 'bg-indigo-600 font-medium text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
            onClick={() => setTab('posted')}
          >
            发单{orders.length > 0 ? `（${orders.length}）` : ''}
          </button>
        </div>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      {tab === 'taken' ? (
        <TakenTab slots={slots} loading={loading} onChanged={handleChanged} />
      ) : (
        <PostedTab
          orders={orders}
          loading={loading}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}

/* ------------------------------ 接单 Tab ------------------------------ */

function TakenTab({
  slots,
  loading,
  onChanged,
}: {
  slots: TakenSlot[];
  loading: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  if (loading) {
    return <p className="text-sm text-slate-500">正在加载接单记录…</p>;
  }
  if (slots.length === 0) {
    return (
      <div className="card text-center">
        <p className="text-sm text-slate-500">还没有接过单。</p>
        <Link href="/" className="btn-primary mt-4">
          去大厅看看
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {slots.map((slot) => (
        <TakenSlotCard key={slot.id} slot={slot} onChanged={onChanged} />
      ))}
    </div>
  );
}

function TakenSlotCard({
  slot,
  onChanged,
}: {
  slot: TakenSlot;
  onChanged: (message: string) => Promise<void>;
}) {
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState('');
  const rejectReasons = slot.lastReject?.reasons?.filter(Boolean) ?? [];

  async function handleAppeal() {
    setAppealBusy(true);
    setAppealError('');
    try {
      // 重复申诉后端幂等返回 200。
      await api.post(`/slots/${slot.id}/appeal`);
      await onChanged('申诉已提交，等待人工复核');
    } catch (err) {
      setAppealError(errorMessage(err, '申诉提交失败'));
    } finally {
      setAppealBusy(false);
    }
  }

  return (
    <article className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_STYLES[slot.order.type]}`}
            >
              {ORDER_TYPE_LABEL[slot.order.type]}
            </span>
            <StatusBadge status={slot.status} />
          </p>
          <Link
            href={`/orders/${slot.order.id}`}
            className="mt-1 block truncate text-base font-semibold text-slate-900 hover:text-indigo-700"
          >
            {slot.order.title}
          </Link>
          <p className="mt-1 text-xs text-slate-500">
            接单 {formatDateTime(slot.acceptedAt)} · 单价 {slot.order.priceXm} XM · 到手{' '}
            {slot.order.payoutXm} XM
          </p>
        </div>
        {slot.status === 'reserved' ? (
          <div className="text-right">
            <p className="text-xs text-slate-500">交付倒计时</p>
            <Countdown deadline={slot.deliverDeadlineAt} className="text-lg font-semibold" />
          </div>
        ) : null}
      </div>

      {rejectReasons.length > 0 ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <p className="font-medium">交付核验未通过</p>
          <p className="mt-1">{rejectReasons.join('、')}</p>
          {slot.lastReject?.at ? (
            <p className="mt-1 text-xs text-rose-600">
              {formatDateTime(slot.lastReject.at)}
            </p>
          ) : null}
          {slot.status === 'reserved' ? (
            slot.appealRequested ? (
              <p className="mt-2 text-xs text-rose-600">已申诉，等待人工复核。</p>
            ) : (
              <button
                type="button"
                className="btn-secondary mt-2 py-1"
                onClick={() => void handleAppeal()}
                disabled={appealBusy}
              >
                {appealBusy ? '提交中…' : '申诉'}
              </button>
            )
          ) : null}
          {appealError ? <p className="mt-2 text-xs text-rose-700">{appealError}</p> : null}
        </div>
      ) : null}

      {slot.status === 'reserved' ? (
        <DeliverForm slotId={slot.id} onChanged={onChanged} />
      ) : null}

      {slot.status === 'verifying' ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          交付已提交，正在自动核验，请稍候。
        </p>
      ) : null}

      {slot.status === 'passed' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>核验通过，等待商家确认放款。</span>
          {slot.confirmedDeadlineAt ? (
            <span className="text-xs">
              自动放款倒计时{' '}
              <Countdown
                deadline={slot.confirmedDeadlineAt}
                className="font-semibold text-emerald-900"
              />
            </span>
          ) : null}
        </div>
      ) : null}

      {slot.status === 'disputed' ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          商家已发起争议，等待平台裁决。
        </p>
      ) : null}

      {slot.status === 'paid' ? (
        <div className="space-y-3">
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
            已结算，收入已入账。
          </p>
          <ReviewForm slotId={slot.id} onChanged={onChanged} />
        </div>
      ) : null}

      {slot.status === 'expired' || slot.status === 'refunded' ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          {slot.status === 'expired'
            ? '该名额已超时释放。'
            : '该名额已退款释放。'}
        </p>
      ) : null}
    </article>
  );
}

function DeliverForm({
  slotId,
  onChanged,
}: {
  slotId: string;
  onChanged: (message: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const deliveryUrl = url.trim();
    if (!deliveryUrl) {
      setError('请填写交付的 X 链接');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/slots/${slotId}/deliver`, { deliveryUrl });
      setUrl('');
      await onChanged('交付已提交，正在核验');
    } catch (err) {
      setError(errorMessage(err, '交付提交失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-2 border-t border-slate-100 pt-3" onSubmit={handleSubmit}>
      <label className="label" htmlFor={`deliver-${slotId}`}>
        交付 X 链接
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`deliver-${slotId}`}
          className="input"
          placeholder="https://x.com/your_handle/status/..."
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn-primary sm:w-32" disabled={busy}>
          {busy ? '提交中…' : '提交交付'}
        </button>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </form>
  );
}

function ReviewForm({
  slotId,
  onChanged,
}: {
  slotId: string;
  onChanged: (message: string) => Promise<void>;
}) {
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/slots/${slotId}/review`, {
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setDone(true);
      await onChanged('评价已提交');
    } catch (err) {
      setError(errorMessage(err, '评价提交失败'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="text-sm text-emerald-700">已评价，感谢反馈。</p>;
  }

  return (
    <form className="space-y-2 border-t border-slate-100 pt-3" onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="label mb-0">评价商家</span>
        <Stars value={score} onChange={setScore} disabled={busy} />
      </div>
      <textarea
        className="input min-h-[64px] resize-y"
        placeholder="补充评价（选填）"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        disabled={busy}
      />
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? '提交中…' : '提交评价'}
      </button>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </form>
  );
}

/* ------------------------------ 发单 Tab ------------------------------ */

function splitList(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function PostedTab({
  orders,
  loading,
  onChanged,
}: {
  orders: MyOrder[];
  loading: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <CreateOrderForm onCreated={onChanged} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">我的商单</h2>
        {loading ? (
          <p className="text-sm text-slate-500">正在加载商单…</p>
        ) : orders.length === 0 ? (
          <p className="card text-sm text-slate-500">还没有发布过商单。</p>
        ) : (
          orders.map((order) => (
            <MyOrderCard key={order.id} order={order} onChanged={onChanged} />
          ))
        )}
      </section>
    </div>
  );
}

interface OrderFormState {
  type: OrderType;
  title: string;
  brief: string;
  keywords: string;
  hashtags: string;
  mentions: string;
  links: string;
  targetTweetUrl: string;
  priceXm: string;
  slots: string;
  expiresInDays: string;
}

const EMPTY_FORM: OrderFormState = {
  type: 'post',
  title: '',
  brief: '',
  keywords: '',
  hashtags: '',
  mentions: '',
  links: '',
  targetTweetUrl: '',
  priceXm: '100',
  slots: '1',
  expiresInDays: '7',
};

function CreateOrderForm({
  onCreated,
}: {
  onCreated: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<OrderFormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function update<K extends keyof OrderFormState>(key: K, value: OrderFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess('');
  }

  const preview = useMemo(() => {
    try {
      const slots = Number(form.slots);
      if (!Number.isInteger(slots) || slots < 1) return null;
      const price = parseXm(form.priceXm);
      if (price < MICRO) return null;
      const totalXm = formatXm(price * BigInt(slots));
      const feeXm = feeOf(totalXm, 5);
      const frozenXm = formatXm(parseXm(totalXm) + parseXm(feeXm));
      return { totalXm, feeXm, frozenXm };
    } catch {
      return null;
    }
  }, [form.priceXm, form.slots]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!preview) {
      setError('请输入合法的单价（≥1 的整数 XM）与名额数');
      return;
    }

    setBusy(true);
    try {
      await api.post('/orders', {
        type: form.type,
        title: form.title.trim(),
        brief: form.brief.trim(),
        // 四类要求始终发送（可为空数组），与后端 DTO 对齐。
        requirements: {
          keywords: splitList(form.keywords),
          hashtags: splitList(form.hashtags),
          mentions: splitList(form.mentions),
          links: splitList(form.links),
        },
        ...(form.targetTweetUrl.trim()
          ? { targetTweetUrl: form.targetTweetUrl.trim() }
          : {}),
        priceXm: form.priceXm.trim(),
        slots: Number(form.slots),
        expiresInDays: Number(form.expiresInDays),
      });
      setForm(EMPTY_FORM);
      setSuccess(`商单已发布，冻结 ${preview.frozenXm} XM（含发单费 ${preview.feeXm} XM）`);
      await onCreated('商单已发布');
    } catch (err) {
      setError(errorMessage(err, '发单失败，请稍后重试'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card space-y-5" onSubmit={handleSubmit}>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">发布商单</h2>
        <p className="mt-1 text-xs text-slate-500">
          发单费 5% 按预算合计向下取整，随托管一并冻结；从未被接单下架时全额退回。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="order-type">
            类型
          </label>
          <select
            id="order-type"
            className="input"
            value={form.type}
            onChange={(event) => update('type', event.target.value as OrderType)}
            disabled={busy}
          >
            <option value="post">发帖</option>
            <option value="comment">评论</option>
            <option value="quote">引用</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="order-title">
            标题
          </label>
          <input
            id="order-title"
            className="input"
            maxLength={120}
            placeholder="例如：宣传新品并带话题"
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="order-brief">
          说明
        </label>
        <textarea
          id="order-brief"
          className="input min-h-[96px] resize-y"
          placeholder="描述任务背景、内容方向与注意事项"
          value={form.brief}
          onChange={(event) => update('brief', event.target.value)}
          disabled={busy}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="label mb-1">交付要求（逗号分隔，可留空）</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="order-keywords">
              关键词
            </label>
            <input
              id="order-keywords"
              className="input"
              placeholder="alpha, beta"
              value={form.keywords}
              onChange={(event) => update('keywords', event.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label className="label" htmlFor="order-hashtags">
              话题标签
            </label>
            <input
              id="order-hashtags"
              className="input"
              placeholder="#xwh, #web3"
              value={form.hashtags}
              onChange={(event) => update('hashtags', event.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label className="label" htmlFor="order-mentions">
              @ 提及
            </label>
            <input
              id="order-mentions"
              className="input"
              placeholder="@account"
              value={form.mentions}
              onChange={(event) => update('mentions', event.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label className="label" htmlFor="order-links">
              要求链接
            </label>
            <input
              id="order-links"
              className="input"
              placeholder="https://..."
              value={form.links}
              onChange={(event) => update('links', event.target.value)}
              disabled={busy}
            />
          </div>
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="order-target">
          目标推文链接{form.type === 'post' ? '（选填，作为参考）' : '（必填）'}
        </label>
        <input
          id="order-target"
          className="input"
          placeholder="https://x.com/user/status/123..."
          value={form.targetTweetUrl}
          onChange={(event) => update('targetTweetUrl', event.target.value)}
          disabled={busy}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="order-price">
            单价（XM）
          </label>
          <input
            id="order-price"
            className="input"
            inputMode="numeric"
            placeholder="100"
            value={form.priceXm}
            onChange={(event) => update('priceXm', event.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label" htmlFor="order-slots">
            名额数
          </label>
          <input
            id="order-slots"
            className="input"
            type="number"
            min={1}
            max={1000}
            value={form.slots}
            onChange={(event) => update('slots', event.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label" htmlFor="order-expires">
            招募天数
          </label>
          <select
            id="order-expires"
            className="input"
            value={form.expiresInDays}
            onChange={(event) => update('expiresInDays', event.target.value)}
            disabled={busy}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={String(day)}>
                {day} 天
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">预算合计</p>
          <p className="mt-1 font-semibold text-slate-900">
            {preview ? `${preview.totalXm} XM` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">发单费（5%）</p>
          <p className="mt-1 font-semibold text-amber-700">
            {preview ? `${preview.feeXm} XM` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">冻结合计</p>
          <p className="mt-1 font-semibold text-indigo-700">
            {preview ? `${preview.frozenXm} XM` : '—'}
          </p>
        </div>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}
      {success ? <div className="alert-info">{success}</div> : null}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? '发布中…' : '发布商单'}
      </button>
    </form>
  );
}

function MyOrderCard({
  order,
  onChanged,
}: {
  order: MyOrder;
  onChanged: (message: string) => Promise<void>;
}) {
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState('');

  const paidCount = order.slots.filter((slot) => slot.status === 'paid').length;
  const occupiedCount = order.slots.filter(
    (slot) => slot.status !== 'expired' && slot.status !== 'refunded',
  ).length;

  async function handleClose() {
    if (!window.confirm('确认下架该商单？未售出名额的托管将退回可用余额。')) {
      return;
    }
    setCloseBusy(true);
    setCloseError('');
    try {
      await api.post(`/orders/${order.id}/close`);
      await onChanged('商单已下架，未售出名额的托管已退回');
    } catch (err) {
      setCloseError(errorMessage(err, '下架失败'));
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <article className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_STYLES[order.type]}`}
            >
              {ORDER_TYPE_LABEL[order.type]}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ORDER_STATUS_STYLES[order.status]}`}
            >
              {ORDER_STATUS_LABEL[order.status]}
            </span>
          </p>
          <Link
            href={`/orders/${order.id}`}
            className="mt-1 block truncate text-base font-semibold text-slate-900 hover:text-indigo-700"
          >
            {order.title}
          </Link>
          <p className="mt-1 text-xs text-slate-500">
            单价 {order.priceXm} XM · 名额进度 {occupiedCount}/{order.slotsTotal}（已结算{' '}
            {paidCount}） · 托管 {order.escrowXm} XM
          </p>
          <p className="mt-1 text-xs text-slate-500">
            发布 {formatDateTime(order.createdAt)} · 招募截止{' '}
            {formatDateTime(order.expiresAt)}
            {order.feeEarned ? ' · 发单费已收取' : ' · 发单费未收取'}
          </p>
        </div>

        {order.status === 'recruiting' ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handleClose()}
            disabled={closeBusy}
          >
            {closeBusy ? '下架中…' : '下架商单'}
          </button>
        ) : null}
      </div>

      {closeError ? <div className="alert-error">{closeError}</div> : null}

      {order.slots.length === 0 ? (
        <p className="text-sm text-slate-500">还没有人接单。</p>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {order.slots.map((slot) => (
            <MerchantSlotRow
              key={slot.id}
              slot={slot}
              priceXm={order.priceXm}
              payoutXm={payoutOf(order.priceXm)}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

const DELETION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function MerchantSlotRow({
  slot,
  priceXm,
  payoutXm,
  onChanged,
}: {
  slot: MyOrderSlot;
  priceXm: string;
  payoutXm: string;
  onChanged: (message: string) => Promise<void>;
}) {
  const [panel, setPanel] = useState<'none' | 'dispute' | 'report' | 'review'>('none');
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const settlementAgeMs = slot.settledAt
    ? Date.now() - new Date(slot.settledAt).getTime()
    : Number.POSITIVE_INFINITY;
  const canReportDeletion =
    slot.status === 'paid' && settlementAgeMs >= 0 && settlementAgeMs <= DELETION_WINDOW_MS;
  const rejectReasons = slot.lastReject?.reasons?.filter(Boolean) ?? [];

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/slots/${slot.id}/confirm`);
      setConfirmOpen(false);
      await onChanged('已确认放款，结算处理中');
    } catch (err) {
      setConfirmOpen(false);
      setError(errorMessage(err, '确认放款失败'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDispute(event: FormEvent) {
    event.preventDefault();
    if (!statement.trim()) {
      setError('请填写争议陈述');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/slots/${slot.id}/dispute`, { statement: statement.trim() });
      setPanel('none');
      setStatement('');
      await onChanged('争议已提交，等待平台裁决');
    } catch (err) {
      setError(errorMessage(err, '争议提交失败'));
    } finally {
      setBusy(false);
    }
  }

  async function handleReport(event: FormEvent) {
    event.preventDefault();
    if (!statement.trim()) {
      setError('请填写举报说明');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/slots/${slot.id}/report-deletion`, {
        statement: statement.trim(),
      });
      setPanel('none');
      setStatement('');
      await onChanged('删帖举报已提交');
    } catch (err) {
      setError(errorMessage(err, '举报提交失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
            {slot.creator.nickname || '匿名用户'}
            <RatingBadge grade={slot.creator.ratingGrade} />
            <StatusBadge status={slot.status} />
          </p>
          <p className="mt-1 text-xs text-slate-500">
            接单 {formatDateTime(slot.acceptedAt)} · 交付截止{' '}
            {formatDateTime(slot.deliverDeadlineAt)}
          </p>
          {slot.deliveryUrl ? (
            <a
              href={slot.deliveryUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-1 block break-all text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              {slot.deliveryUrl}
            </a>
          ) : null}
          {rejectReasons.length > 0 ? (
            <p className="mt-1 text-xs text-rose-600">
              核验驳回：{rejectReasons.join('、')}
            </p>
          ) : null}
        </div>

        {slot.status === 'reserved' ? (
          <span className="text-xs text-slate-500">
            交付倒计时 <Countdown deadline={slot.deliverDeadlineAt} className="font-semibold" />
          </span>
        ) : null}
        {slot.status === 'passed' && slot.confirmedDeadlineAt ? (
          <span className="text-xs text-slate-500">
            自动放款倒计时{' '}
            <Countdown deadline={slot.confirmedDeadlineAt} className="font-semibold" />
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {slot.status === 'passed' ? (
          <>
            <button
              type="button"
              className="btn-primary py-1"
              onClick={() => {
                setError('');
                setConfirmOpen(true);
              }}
              disabled={busy}
            >
              确认放款
            </button>
            <button
              type="button"
              className="btn-secondary py-1"
              onClick={() => setPanel(panel === 'dispute' ? 'none' : 'dispute')}
              disabled={busy}
            >
              发起争议
            </button>
          </>
        ) : null}

        {canReportDeletion ? (
          <button
            type="button"
            className="btn-secondary py-1"
            onClick={() => setPanel(panel === 'report' ? 'none' : 'report')}
            disabled={busy}
          >
            举报删帖
          </button>
        ) : null}

        {slot.status === 'paid' ? (
          <button
            type="button"
            className="btn-secondary py-1"
            onClick={() => setPanel(panel === 'review' ? 'none' : 'review')}
            disabled={busy}
          >
            评价接单方
          </button>
        ) : null}

        {slot.status === 'verifying' ? (
          <span className="text-xs text-sky-700">核验中…</span>
        ) : null}
        {slot.status === 'disputed' ? (
          <span className="text-xs text-rose-700">争议中，等待平台裁决</span>
        ) : null}
        {slot.status === 'expired' || slot.status === 'refunded' ? (
          <span className="text-xs text-slate-500">
            {slot.status === 'expired' ? '已超时释放' : '已退款释放'}
          </span>
        ) : null}
      </div>

      {panel === 'dispute' ? (
        <form className="space-y-2" onSubmit={handleDispute}>
          <textarea
            className="input min-h-[64px] resize-y"
            placeholder="说明交付未达要求的具体原因（必填）"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary py-1" disabled={busy}>
              {busy ? '提交中…' : '提交争议'}
            </button>
            <button
              type="button"
              className="btn-secondary py-1"
              onClick={() => setPanel('none')}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}

      {panel === 'report' ? (
        <form className="space-y-2" onSubmit={handleReport}>
          <textarea
            className="input min-h-[64px] resize-y"
            placeholder="说明删帖情况（必填）"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary py-1" disabled={busy}>
              {busy ? '提交中…' : '提交举报'}
            </button>
            <button
              type="button"
              className="btn-secondary py-1"
              onClick={() => setPanel('none')}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}

      {panel === 'review' ? (
        <ReviewForm slotId={slot.id} onChanged={onChanged} />
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="确认放款？"
        danger
        busy={busy}
        confirmLabel="确认放款"
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
        onConfirm={() => void handleConfirm()}
        description={
          <div className="space-y-1">
            <p>
              该名额金额 <strong>{priceXm} XM</strong>，接单方到手{' '}
              <strong>{payoutXm} XM</strong>。
            </p>
            <p className="text-amber-700">
              确认后立即结算，不可撤销。请先核对交付内容与核验结果。
            </p>
            {error ? <div className="alert-error">{error}</div> : null}
          </div>
        }
      />

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </li>
  );
}
