import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import CopyButton from '@/components/CopyButton';
import RatingBadge from '@/components/RatingBadge';
import Stars from '@/components/Stars';
import { formatDateTime } from '@/lib/orders';
import { absoluteUrl } from '@/lib/site';
import {
  type AccountRating,
  type PublicUser,
  type UserRatingSummary,
  fetchAccountRating,
  fetchPublicUser,
  fetchUserRating,
  formatComponent,
  formatJoined,
  RATING_COMPONENT_LABEL,
  RATING_FLAG_LABEL,
} from '@/lib/users';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

interface ProfileData {
  profile: PublicUser;
  summary: UserRatingSummary;
  accountRating: AccountRating | null;
}

/** 同一请求内 generateMetadata 与页面共享缓存，避免重复请求后端。 */
const loadProfileData = cache(async (id: string): Promise<ProfileData> => {
  const [profile, summary] = await Promise.all([
    fetchPublicUser(id),
    fetchUserRating(id),
  ]);
  const accountRating =
    profile.xBound && profile.handle
      ? await fetchAccountRating(profile.handle).catch(() => null)
      : null;
  return { profile, summary, accountRating };
});

function displayName(profile: PublicUser): string {
  return profile.handle ? `@${profile.handle}` : '未绑定 X 的用户';
}

function ratingText(profile: PublicUser, summary: UserRatingSummary): string {
  const parts = [
    profile.ratingGrade ? `评级 ${profile.ratingGrade}` : '暂无评级',
    summary.average !== null ? `平均 ${summary.average.toFixed(1)} 星` : '暂无评价',
    `已完成 ${profile.completedCount} 单`,
  ];
  return parts.join(' · ');
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  try {
    const { profile, summary } = await loadProfileData(params.id);
    const title = profile.handle ? `@${profile.handle} 的公开主页` : '用户主页';
    const description = ratingText(profile, summary);
    const image = absoluteUrl(`/api/og/u/${profile.id}`);

    return {
      title,
      description,
      openGraph: {
        type: 'profile',
        title,
        description,
        url: absoluteUrl(`/u/${profile.id}`),
        images: [{ url: image, width: 1200, height: 630, alt: title }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [image],
      },
    };
  } catch {
    return { title: '用户主页' };
  }
}

export default async function PublicProfilePage({ params }: PageProps) {
  let data: ProfileData;
  try {
    data = await loadProfileData(params.id);
  } catch (err) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-500 transition hover:text-indigo-700"
        >
          ← 返回大厅
        </Link>
        <div className="card space-y-3 border-red-200 bg-red-50/40" role="alert">
          <h1 className="text-xl font-bold text-red-800">用户主页加载失败</h1>
          <p className="text-sm text-red-700">
            {err instanceof Error ? err.message : '用户不存在或加载失败'}
          </p>
          <Link href="/" className="btn-secondary w-fit">
            返回大厅
          </Link>
        </div>
      </div>
    );
  }

  const { profile, summary, accountRating } = data;
  const name = displayName(profile);
  const initial = profile.handle ? profile.handle.slice(0, 1).toUpperCase() : 'X';
  const xUrl =
    profile.xBound && profile.handle
      ? `https://x.com/${encodeURIComponent(profile.handle)}`
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="card space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 text-2xl font-bold text-indigo-700">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-all text-2xl font-bold tracking-tight text-slate-900">
                  {name}
                </h1>
                <RatingBadge grade={profile.ratingGrade} />
                {profile.xBound ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <span aria-hidden="true">✓</span> X 已认证
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                    未绑定 X
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                入驻 {formatJoined(profile.joined)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {xUrl ? (
              <a
                href={xUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn-secondary"
              >
                X 主页 ↗
              </a>
            ) : null}
            <CopyButton label="分享主页" copiedLabel="链接已复制" />
          </div>
        </div>

        <dl className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">星级均分</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              {summary.average !== null ? (
                <>
                  <Stars value={Math.round(summary.average)} label="星级均分" />
                  <span className="text-lg font-semibold text-slate-900">
                    {summary.average.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-500">
                    （{summary.count} 条评价）
                  </span>
                </>
              ) : (
                <span className="text-sm text-slate-500">暂无评价</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">完成单数</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">
              {profile.completedCount}
              <span className="ml-1 text-xs font-normal text-slate-500">单</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">账户评级</dt>
            <dd className="mt-1">
              <RatingBadge grade={profile.ratingGrade} />
            </dd>
          </div>
        </dl>
      </section>

      {accountRating ? <RatingDetail rating={accountRating} /> : null}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">近期评价</h2>
          <span className="text-sm text-slate-500">共 {summary.count} 条</span>
        </div>

        {summary.recent.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">还没有收到评价。</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {summary.recent.map((review) => (
              <li key={review.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/u/${review.from.id}`}
                      className="text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline"
                    >
                      {review.from.nickname?.trim() || '匿名用户'}
                    </Link>
                    <Stars value={review.score} label="评价星级" />
                  </div>
                  <time className="text-xs text-slate-400" dateTime={review.createdAt}>
                    {formatDateTime(review.createdAt)}
                  </time>
                </div>
                {review.comment ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                    {review.comment}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">（未填写评价内容）</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RatingDetail({ rating }: { rating: AccountRating }) {
  const entries = Object.entries(rating.breakdown ?? {});

  return (
    <section className="card">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-base font-semibold text-slate-900">
          <span>
            评级明细
            <span className="ml-2 text-sm font-normal text-slate-500">
              {rating.score}/100
            </span>
          </span>
          <span className="text-xs font-normal text-slate-400">
            更新于 {formatDateTime(rating.computed_at)}
          </span>
        </summary>

        <div className="mt-4 space-y-3">
          {rating.flags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {rating.flags.map((flag) => (
                <span
                  key={flag}
                  className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-inset ring-amber-200"
                >
                  {RATING_FLAG_LABEL[flag] ?? flag}
                </span>
              ))}
            </div>
          ) : null}

          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">暂无分数明细。</p>
          ) : (
            <ul className="space-y-3">
              {entries.map(([key, value]) => {
                const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
                return (
                  <li key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">
                        {RATING_COMPONENT_LABEL[key] ?? key}
                      </span>
                      <span className="font-medium text-slate-700">
                        {formatComponent(value)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
