'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import api, { errorMessage, getAccessToken } from '@/lib/api';
import { tierProgress } from '@/lib/invite';
import { buildInviteUrl } from '@/lib/site';

interface ReferralMine {
  code: string | null;
  inviteesCount: number;
  tier: number;
  rebateTotalXm: string;
}

export default function InvitePage() {
  const router = useRouter();
  const [data, setData] = useState<ReferralMine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api
      .get<ReferralMine>('/referral/mine')
      .then(({ data: mine }) => {
        if (!cancelled) setData(mine);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, '邀请数据加载失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const progress = data ? tierProgress(data.inviteesCount) : null;
  const inviteUrl = data?.code ? buildInviteUrl(data.code) : '';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">邀请好友</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          好友通过你的链接注册并完成 X 绑定后计入邀请人数；好友产生的平台手续费，按你当前档位返佣。
        </p>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}
      {loading ? <p className="text-sm text-slate-500">加载中…</p> : null}

      {data && progress ? (
        <>
          <section className="card space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">我的邀请码</p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-indigo-700">
                  {data.code ?? '—'}
                </p>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                当前返佣 {data.tier}%
              </span>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-500">你的专属邀请链接</p>
              {inviteUrl ? (
                <>
                  <p className="mt-2 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                    {inviteUrl}
                  </p>
                  <div className="mt-3">
                    <CopyButton
                      text={inviteUrl}
                      label="复制邀请链接"
                      copiedLabel="邀请链接已复制"
                    />
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  邀请码生成中，请稍后刷新页面。
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                好友打开链接后，邀请码会自动填入登录页。
              </p>
            </div>
          </section>

          <section className="card space-y-4">
            <dl className="grid grid-cols-3 gap-3">
              <div>
                <dt className="text-xs text-slate-500">已邀人数</dt>
                <dd className="mt-1 text-2xl font-bold text-slate-900">
                  {data.inviteesCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">当前档位</dt>
                <dd className="mt-1 text-2xl font-bold text-indigo-700">
                  {data.tier}%
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">返佣累计</dt>
                <dd className="mt-1 text-2xl font-bold text-emerald-700">
                  {data.rebateTotalXm}
                  <span className="ml-1 text-sm font-normal text-emerald-600">XM</span>
                </dd>
              </div>
            </dl>

            <div className="border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-slate-700">{progress.text}</span>
                <span className="text-xs text-slate-500">
                  {progress.nextTier === null
                    ? `已邀 ${data.inviteesCount} 人`
                    : `${data.inviteesCount} / ${progress.nextTier === 40 ? 10 : 5} 人`}
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
              >
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                规则：邀请 5 人升到 30%，满 10 人升到 40%。仅统计已完成 X 绑定的有效好友。
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
