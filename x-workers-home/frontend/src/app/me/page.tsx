'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import api, { AuthUser, clearTokens, errorMessage, getAccessToken } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';

const USER_STATUS_LABEL: Record<string, string> = {
  pending_x_binding: '待绑定 X',
  active: '正常',
  suspended: '已封禁',
};

const ROLE_LABEL: Record<string, string> = {
  user: '用户',
  admin: '管理员',
};

const BINDING_STATUS_LABEL: Record<string, string> = {
  none: '未绑定',
  pending: '验证中',
  active: '已绑定',
  manual_review: '人工审核中',
};

type BindingChangeKind = 'wallet' | 'x';
type BindingChangeStatus = 'pending' | 'approved' | 'rejected';

interface BindingChangeView {
  id: string;
  kind: BindingChangeKind;
  newValue: string;
  status: BindingChangeStatus;
  effectiveAt: string;
  appliedAt: string | null;
  createdAt: string;
}

const CHANGE_KIND_LABEL: Record<BindingChangeKind, string> = {
  wallet: '钱包',
  x: 'X 账号',
};

const CHANGE_STATUS_LABEL: Record<BindingChangeStatus, string> = {
  pending: '待生效（冷静期 / 审核中）',
  approved: '已审核，等待生效',
  rejected: '已驳回',
};

const CHANGE_STATUS_STYLES: Record<BindingChangeStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/** 浏览器注入钱包的最小 EIP-1193 接口（避免为一次签名引入 ethers）。 */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export default function MePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changes, setChanges] = useState<BindingChangeView[]>([]);
  const [changesError, setChangesError] = useState('');
  const [changesLoading, setChangesLoading] = useState(true);

  const loadChanges = useCallback(async () => {
    try {
      const { data } = await api.get<BindingChangeView[]>('/bindings/changes');
      setChanges(data ?? []);
      setChangesError('');
    } catch (err) {
      setChangesError(errorMessage(err, '加载改绑申请失败'));
    } finally {
      setChangesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api
      .get<AuthUser>('/auth/me')
      .then(({ data }) => {
        if (!cancelled) setUser(data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, '加载账户信息失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void loadChanges();

    return () => {
      cancelled = true;
    };
  }, [router, loadChanges]);

  function handleLogout() {
    clearTokens();
    router.replace('/login');
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">我的账户</h1>
        <button type="button" className="btn-secondary" onClick={handleLogout}>
          退出登录
        </button>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}
      {loading ? <p className="text-sm text-slate-500">加载中…</p> : null}

      {user ? (
        <div className="card space-y-5">
          <h2 className="text-base font-semibold text-slate-900">账户与绑定</h2>

          <div>
            <p className="text-sm text-slate-500">钱包地址</p>
            <p className="mt-1 break-all font-mono text-sm">{user.address}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-slate-500">X 绑定</p>
              <p className="mt-1 text-sm font-medium">
                {BINDING_STATUS_LABEL[user.x_binding?.status ?? 'none'] ??
                  user.x_binding?.status ??
                  '未绑定'}
                {user.x_binding?.handle ? (
                  <span className="ml-2 font-normal text-slate-500">
                    @{user.x_binding.handle}
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">账号状态</p>
              <p className="mt-1 text-sm font-medium">
                {USER_STATUS_LABEL[user.status] ?? user.status}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">角色</p>
              <p className="mt-1 text-sm font-medium">
                {ROLE_LABEL[user.role] ?? user.role}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">评分等级</p>
              <p className="mt-1 text-sm font-medium">{user.rating_grade ?? '暂无'}</p>
            </div>
          </div>

          {user.status !== 'active' || user.x_binding?.status !== 'active' ? (
            <div className="alert-info">
              完成 X 绑定并通过验证后，账号才会激活。
              <button
                type="button"
                className="ml-1 underline underline-offset-2"
                onClick={() => router.push('/login')}
              >
                前往绑定
              </button>
            </div>
          ) : null}

          <div className="border-t border-slate-100 pt-5">
            <WalletChangeForm onSubmitted={loadChanges} />
          </div>

          <div className="border-t border-slate-100 pt-5">
            <XChangeForm onSubmitted={loadChanges} />
          </div>

          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">待生效 / 历史改绑</h3>
            {changesError ? <div className="alert-error mt-3">{changesError}</div> : null}
            {changesLoading ? (
              <p className="mt-2 text-sm text-slate-500">正在加载改绑申请…</p>
            ) : changes.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">暂无改绑申请。</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {changes.map((change) => (
                  <li key={change.id} className="space-y-1 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-slate-800">
                        {CHANGE_KIND_LABEL[change.kind] ?? change.kind}改绑
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          CHANGE_STATUS_STYLES[change.status] ??
                          'bg-slate-100 text-slate-600 ring-slate-200'
                        }`}
                      >
                        {CHANGE_STATUS_LABEL[change.status] ?? change.status}
                      </span>
                    </div>
                    <p className="break-all font-mono text-xs text-slate-600">
                      {change.kind === 'x' ? '@' : ''}
                      {change.newValue}
                    </p>
                    <p className="text-xs text-slate-500">
                      申请 {formatDateTime(change.createdAt)} · 生效时间{' '}
                      {formatDateTime(change.effectiveAt)}
                      {change.appliedAt
                        ? ` · 已生效 ${formatDateTime(change.appliedAt)}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ 钱包改绑 ------------------------------ */

function WalletChangeForm({ onSubmitted }: { onSubmitted: () => Promise<void> }) {
  const [newAddress, setNewAddress] = useState('');
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function resetMessages() {
    setError('');
    setNotice('');
  }

  async function handleGetMessage() {
    resetMessages();
    setMessage('');
    setSignature('');
    const address = newAddress.trim();
    if (!address) {
      setError('请输入新钱包地址');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.get<{ message: string }>(
        '/bindings/wallet/change/message',
        { params: { newAddress: address } },
      );
      setMessage(data.message);
      setNotice('已生成签名消息，请使用新钱包签名（或手动粘贴 signature）。');
    } catch (err) {
      setError(errorMessage(err, '获取签名消息失败'));
    } finally {
      setBusy(false);
    }
  }

  async function handleWalletSign() {
    resetMessages();
    if (!message) {
      setError('请先获取签名消息');
      return;
    }
    const ethereum = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (!ethereum) {
      setError('未检测到浏览器钱包，请在下方手动粘贴 signature');
      return;
    }
    setSigning(true);
    try {
      const accounts = (await ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[] | undefined;
      if (!accounts || accounts.length === 0) {
        throw new Error('浏览器钱包未连接');
      }
      const result = await ethereum.request({
        method: 'personal_sign',
        params: [message, accounts[0]],
      });
      setSignature(String(result));
      setNotice('签名已生成，请确认后提交改绑申请。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '钱包签名失败');
    } finally {
      setSigning(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    resetMessages();
    if (!message) {
      setError('请先获取签名消息');
      return;
    }
    if (!signature.trim()) {
      setError('请使用新钱包签名，或手动粘贴 signature');
      return;
    }
    setBusy(true);
    try {
      await api.post('/bindings/wallet/change', {
        newAddress: newAddress.trim(),
        signature: signature.trim(),
      });
      setNotice(
        '钱包改绑申请已提交：24 小时冷静期 + 人工审核，生效前不可提现。',
      );
      setNewAddress('');
      setMessage('');
      setSignature('');
      await onSubmitted();
    } catch (err) {
      setError(errorMessage(err, '提交钱包改绑失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">钱包改绑</h3>
        <p className="mt-1 text-xs text-slate-500">
          需用新钱包对消息签名；提交后进入 24 小时冷静期并等待人工审核，生效前不可提现。
        </p>
      </div>

      <div>
        <label className="label" htmlFor="wallet-new-address">
          新钱包地址
        </label>
        <input
          id="wallet-new-address"
          className="input font-mono"
          placeholder="0x..."
          value={newAddress}
          onChange={(event) => {
            setNewAddress(event.target.value);
            // 地址变化后旧消息/签名作废，避免用旧消息签新地址。
            setMessage('');
            setSignature('');
            resetMessages();
          }}
          disabled={busy || signing}
        />
      </div>

      <button
        type="button"
        className="btn-secondary py-1"
        onClick={() => void handleGetMessage()}
        disabled={busy || signing}
      >
        获取签名消息
      </button>

      {message ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">待签名消息</p>
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">
            {message}
          </pre>
          <button
            type="button"
            className="btn-secondary py-1"
            onClick={() => void handleWalletSign()}
            disabled={busy || signing}
          >
            {signing ? '等待钱包签名…' : '用浏览器钱包签名（请切换到新钱包）'}
          </button>
          <div>
            <label className="label" htmlFor="wallet-signature">
              或手动粘贴 signature
            </label>
            <textarea
              id="wallet-signature"
              className="input min-h-[72px] resize-y font-mono"
              placeholder="0x..."
              value={signature}
              onChange={(event) => {
                setSignature(event.target.value);
                resetMessages();
              }}
              disabled={busy || signing}
            />
          </div>
        </div>
      ) : null}

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      <button type="submit" className="btn-primary" disabled={busy || signing}>
        {busy ? '提交中…' : '提交钱包改绑'}
      </button>
    </form>
  );
}

/* ------------------------------ X 改绑 ------------------------------ */

function XChangeForm({ onSubmitted }: { onSubmitted: () => Promise<void> }) {
  const [handle, setHandle] = useState('');
  const [result, setResult] = useState<{
    code: string;
    handle: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    const value = handle.trim();
    if (!value) {
      setError('请输入新的 X handle');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post<{
        code: string;
        handle: string;
        expiresAt: string;
      }>('/bindings/x/change', { handle: value });
      setResult(data);
      setHandle('');
      setNotice(
        `验证码 ${data.code}：请在 24 小时内写入 @${data.handle} 的 bio 或最近 5 条推文。验证通过后进入 24 小时冷静期并等待人工审核。`,
      );
      await onSubmitted();
    } catch (err) {
      setError(errorMessage(err, '提交 X 改绑失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">X 改绑</h3>
        <p className="mt-1 text-xs text-slate-500">
          输入新 handle 后生成验证码；验证通过后进入 24 小时冷静期并等待人工审核。
        </p>
      </div>

      <div>
        <label className="label" htmlFor="x-new-handle">
          新 X handle
        </label>
        <input
          id="x-new-handle"
          className="input"
          placeholder="@new_handle"
          value={handle}
          onChange={(event) => {
            setHandle(event.target.value);
            setError('');
            setNotice('');
          }}
          disabled={busy}
        />
      </div>

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}
      {result ? (
        <p className="text-xs text-slate-500">
          验证码有效期至 {formatDateTime(result.expiresAt)}。
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? '提交中…' : '提交 X 改绑'}
      </button>
    </form>
  );
}
