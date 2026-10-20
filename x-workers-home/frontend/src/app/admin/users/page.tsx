'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import RatingBadge from '@/components/RatingBadge';
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
  type PillTone,
} from '@/components/admin/ui';
import adminApi from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';

interface AdminUserRow {
  id: string;
  address: string;
  nickname: string | null;
  status: string;
  role: string;
  violations: number;
  ratingGrade: string | null;
  xHandle: string | null;
  createdAt: string;
}

interface UserListResult {
  items: AdminUserRow[];
  total: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending_x_binding: '待绑定 X',
  active: '正常',
  suspended: '已封禁',
};

const STATUS_TONE: Record<string, PillTone> = {
  pending_x_binding: 'amber',
  active: 'green',
  suspended: 'red',
};

const ROLE_LABEL: Record<string, string> = {
  user: '用户',
  admin: '管理员',
};

export default function AdminUsersPage() {
  const [qInput, setQInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ user: AdminUserRow; suspend: boolean } | null>(
    null,
  );

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get<UserListResult>('/admin/users', {
        params: q ? { q } : {},
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(data?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err, '加载用户列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(appliedQ);
  }, [appliedQ, load]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedQ(qInput.trim());
  }

  async function handleStatusChange() {
    if (!target) return;
    const { user, suspend } = target;
    setBusy(true);
    setError('');
    try {
      await adminApi.post(
        `/admin/users/${user.id}/${suspend ? 'suspend' : 'unsuspend'}`,
      );
      setNotice(
        `${suspend ? '已封禁' : '已解封'}用户 ${user.address.slice(0, 10)}…（${user.nickname || '未命名'}）。`,
      );
      setTarget(null);
      await load(appliedQ);
    } catch (err) {
      const message = errorMessage(err, '更新用户状态失败');
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户管理"
        description="按地址 / 昵称 / 状态 / X handle 搜索；查看评级与违约记录，封禁或解封账号。"
      />

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
        onSubmit={handleSearch}
      >
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="user-q">
            搜索
          </label>
          <input
            id="user-q"
            className="input"
            placeholder="钱包地址 / 昵称 / 账号状态 / X handle"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '查询中…' : '搜索'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={() => {
            setQInput('');
            setAppliedQ('');
          }}
        >
          清空
        </button>
      </form>

      <div className="text-sm text-slate-600">共 {total} 个用户（最多展示 200 条）</div>

      <TableShell>
        <thead>
          <tr>
            <Th>用户</Th>
            <Th>X 账号</Th>
            <Th>角色</Th>
            <Th>评级</Th>
            <Th>违约</Th>
            <Th>状态</Th>
            <Th>注册时间</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <StateRow
            colSpan={8}
            loading={loading}
            empty={items.length === 0}
            emptyLabel="没有符合条件的用户。"
          />
          {!loading &&
            items.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50/60">
                <Td>
                  <p className="font-medium text-slate-900">{user.nickname || '未命名用户'}</p>
                  <p className="mt-0.5 max-w-[220px] break-all font-mono text-[11px] text-slate-500">
                    {user.address}
                  </p>
                  <CopyButton
                    text={user.address}
                    label="复制地址"
                    className={`${BTN_SMALL} mt-1`}
                  />
                </Td>
                <Td>
                  {user.xHandle ? (
                    <span className="text-slate-700">@{user.xHandle}</span>
                  ) : (
                    <span className="text-xs text-slate-400">未绑定</span>
                  )}
                </Td>
                <Td>
                  <Pill tone={user.role === 'admin' ? 'violet' : 'slate'}>
                    {ROLE_LABEL[user.role] ?? user.role}
                  </Pill>
                </Td>
                <Td>
                  <RatingBadge grade={user.ratingGrade} />
                </Td>
                <Td>
                  <span
                    className={`tabular-nums ${
                      user.violations > 0 ? 'font-semibold text-rose-600' : 'text-slate-600'
                    }`}
                  >
                    {user.violations}
                  </span>
                </Td>
                <Td>
                  <Pill tone={STATUS_TONE[user.status] ?? 'slate'}>
                    {STATUS_LABEL[user.status] ?? user.status}
                  </Pill>
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(user.createdAt)}
                  </span>
                </Td>
                <Td>
                  {user.role === 'admin' ? (
                    <span className="text-xs text-slate-400">管理员不可封禁</span>
                  ) : user.status === 'suspended' ? (
                    <button
                      type="button"
                      className={BTN_SMALL}
                      disabled={busy}
                      onClick={() => setTarget({ user, suspend: false })}
                    >
                      解封
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={BTN_SMALL_DANGER}
                      disabled={busy}
                      onClick={() => setTarget({ user, suspend: true })}
                    >
                      封禁
                    </button>
                  )}
                </Td>
              </tr>
            ))}
        </tbody>
      </TableShell>

      <ConfirmDialog
        open={!!target}
        title={target?.suspend ? '确认封禁该用户？' : '确认解封该用户？'}
        danger={!!target?.suspend}
        busy={busy}
        confirmLabel={target?.suspend ? '确认封禁' : '确认解封'}
        onCancel={() => {
          if (!busy) setTarget(null);
        }}
        onConfirm={() => void handleStatusChange()}
        description={
          target ? (
            <div className="space-y-1">
              <p>
                用户：{target.user.nickname || '未命名'}（
                <span className="break-all font-mono text-xs">{target.user.address}</span>）
              </p>
              {target.suspend ? (
                <p className="text-rose-600">
                  封禁后该用户无法登录/接单/提现；不会自动处理其未完成订单与余额。
                </p>
              ) : (
                <p className="text-emerald-700">解封后账号恢复为正常状态，可重新登录使用。</p>
              )}
              {error ? <div className="alert-error">{error}</div> : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
