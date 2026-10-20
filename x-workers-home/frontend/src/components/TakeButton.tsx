'use client';

import axios from 'axios';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import api, { API_BASE_URL, errorMessage, getAccessToken } from '@/lib/api';
import type { MySlotsResponse, OrderStatus, SlotStatus } from '@/lib/orders';

interface TakeButtonProps {
  orderId: string;
  status: OrderStatus;
  slotsAvailable: number;
  expiresAt: string;
}

/** 仍占名额的状态（expired / refunded 回自由池，不算“已在本单中”）。 */
const OCCUPYING_SLOT_STATUSES: SlotStatus[] = [
  'reserved',
  'verifying',
  'passed',
  'disputed',
  'paid',
];

export default function TakeButton({
  orderId,
  status,
  slotsAvailable,
  expiresAt,
}: TakeButtonProps) {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const [mine, setMine] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoggedIn(false);
      return;
    }
    setLoggedIn(true);

    let cancelled = false;
    // 公开详情页的“我是否已在本单”探测必须绕过全局 api 实例：
    // 该实例在 401 且 refresh 失败时会清 token 并强制跳 /login，
    // 这会让过期登录态的访客一进公开页就被登出。这里用裸 axios
    // 手动带 Authorization，失败时只降级为匿名视图。
    axios
      .get<MySlotsResponse>(`${API_BASE_URL}/me/slots`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(({ data }) => {
        if (cancelled) return;
        const items = data.items ?? [];
        setMine(
          items.some(
            (slot) =>
              slot.orderId === orderId &&
              OCCUPYING_SLOT_STATUSES.includes(slot.status),
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        const status = axios.isAxiosError(err)
          ? err.response?.status
          : undefined;
        if (status === 401 || status === 403) {
          // 仅切回匿名视图：不清 token、不跳转；重复抢单由后端兜底。
          setLoggedIn(false);
          setMine(false);
        }
        // 网络错误等保留当前登录态，不阻断公开浏览与抢单校验。
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    const deadline = new Date(expiresAt).getTime();
    setExpired(Number.isFinite(deadline) && deadline <= Date.now());
  }, [expiresAt]);

  let disabledReason = '';
  if (status === 'closed') {
    disabledReason = '该商单已下架，无法抢单';
  } else if (status === 'completed') {
    disabledReason = '该商单已完成，无法抢单';
  } else if (mine) {
    // 「已在本单中」比「名额已满」更能解释为什么这个用户不能抢。
    disabledReason = '你已在本单中，无需重复抢单';
  } else if (slotsAvailable <= 0) {
    disabledReason = '名额已满，无法抢单';
  } else if (expired) {
    disabledReason = '该商单不可接（已过招募截止时间）';
  }

  const disabled = busy || !!success || !!disabledReason;

  async function handleTake() {
    setError('');
    setSuccess('');

    if (!getAccessToken()) {
      router.push('/login');
      return;
    }

    setBusy(true);
    try {
      await api.post(`/orders/${orderId}/take`);
      setMine(true);
      setSuccess('已接单，3 小时内完成交付');
      // 刷新服务端详情：名额 -1、名额列表出现自己的 reserved 记录。
      router.refresh();
    } catch (err) {
      const message = errorMessage(err, '抢单失败，请稍后重试');
      setError(message);
      if (message.includes('你已在本单中')) {
        setMine(true);
      }
      if (message.includes('名额已满') || message.includes('该商单不可接')) {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  let label = '立即抢单';
  if (success) label = '已接单';
  else if (busy) label = '抢单中…';
  else if (disabledReason) label = '暂不可抢';
  else if (!loggedIn) label = '登录后抢单';

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn-primary w-full"
        onClick={() => void handleTake()}
        disabled={disabled}
        title={disabledReason || undefined}
      >
        {label}
      </button>

      {disabledReason && !success ? (
        <p className="text-xs text-slate-500">{disabledReason}</p>
      ) : null}
      {!loggedIn && !disabledReason ? (
        <p className="text-xs text-slate-500">
          登录并完成 X 绑定后即可抢单。
        </p>
      ) : null}

      <div aria-live="polite">
        {success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
          </div>
        ) : null}
        {error ? <div className="alert-error mt-2">{error}</div> : null}
      </div>
    </div>
  );
}
