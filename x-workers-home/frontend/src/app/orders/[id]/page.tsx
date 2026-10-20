import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, cache } from 'react';
import RatingBadge from '@/components/RatingBadge';
import TakeButton from '@/components/TakeButton';
import { payoutOf } from '@/lib/format';
import {
  defaultMinChars,
  fetchOrderDetail,
  formatDateTime,
  ORDER_STATUS_LABEL,
  ORDER_TYPE_LABEL,
  SLOT_STATUS_LABEL,
  type OrderDetailView,
  type OrderRequirements,
  type OrderStatus,
  type OrderType,
  type SlotStatus,
} from '@/lib/orders';
import { absoluteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** generateMetadata 与页面共享同一次后端请求。 */
const loadOrder = cache((id: string) => fetchOrderDetail(id));

interface OrderDetailPageProps {
  params: { id: string };
}

export async function generateMetadata({
  params,
}: OrderDetailPageProps): Promise<Metadata> {
  try {
    const order = await loadOrder(params.id);
    const title = `${order.title} · ${ORDER_TYPE_LABEL[order.type]}商单`;
    const description = `单价 ${order.priceXm} XM，接单到手 ${payoutOf(
      order.priceXm,
    )} XM，剩余 ${order.slotsAvailable}/${order.slotsTotal} 个名额。`;
    const image = absoluteUrl(`/api/og/order/${order.id}`);

    return {
      title: order.title,
      description,
      openGraph: {
        type: 'website',
        title,
        description,
        url: absoluteUrl(`/orders/${order.id}`),
        images: [{ url: image, width: 1200, height: 630, alt: order.title }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [image],
      },
    };
  } catch {
    return { title: '商单详情' };
  }
}

const TYPE_STYLES: Record<OrderType, string> = {
  post: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  comment: 'bg-sky-50 text-sky-700 ring-sky-200',
  quote: 'bg-violet-50 text-violet-700 ring-violet-200',
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  recruiting: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-300',
  completed: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};

const SLOT_STATUS_STYLES: Record<SlotStatus, string> = {
  reserved: 'bg-amber-50 text-amber-700 ring-amber-200',
  verifying: 'bg-sky-50 text-sky-700 ring-sky-200',
  passed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  disputed: 'bg-rose-50 text-rose-700 ring-rose-200',
  paid: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  refunded: 'bg-slate-100 text-slate-600 ring-slate-200',
  expired: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export default function OrderDetailPage({ params }: OrderDetailPageProps) {
  return (
    <Suspense fallback={<DetailLoading />}>
      <OrderDetail id={params.id} />
    </Suspense>
  );
}

async function OrderDetail({ id }: { id: string }) {
  let order: OrderDetailView;
  try {
    order = await loadOrder(id);
  } catch (err) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="card space-y-3 border-red-200 bg-red-50/40" role="alert">
          <h1 className="text-xl font-bold text-red-800">商单加载失败</h1>
          <p className="text-sm text-red-700">
            {err instanceof Error ? err.message : '商单不存在或加载失败'}
          </p>
          <Link href="/" className="btn-secondary w-fit">
            返回大厅
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BackLink />

      <section className="card space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_STYLES[order.type]}`}
          >
            {ORDER_TYPE_LABEL[order.type]}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[order.status]}`}
          >
            {ORDER_STATUS_LABEL[order.status]}
          </span>
          {order.status === 'recruiting' && order.slotsAvailable <= 0 ? (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
              名额已满
            </span>
          ) : null}
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {order.title}
          </h1>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">
            {order.brief}
          </p>
        </div>

        <dl className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">单价</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">
              {order.priceXm}
              <span className="ml-1 text-xs font-normal text-slate-500">XM</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">接单到手</dt>
            <dd className="mt-1 text-lg font-semibold text-emerald-700">
              {payoutOf(order.priceXm)}
              <span className="ml-1 text-xs font-normal text-emerald-600">XM</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">剩余名额</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">
              {order.slotsAvailable}
              <span className="text-sm font-normal text-slate-400">
                /{order.slotsTotal}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">招募截止</dt>
            <dd className="mt-1 text-sm font-medium text-slate-800">
              {formatDateTime(order.expiresAt)}
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
          商家评级
          <RatingBadge grade={order.merchantRatingGrade} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <aside className="space-y-4 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <div className="card space-y-4">
            <div>
              <p className="text-sm text-slate-500">接单到手</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">
                {payoutOf(order.priceXm)}
                <span className="ml-1 text-sm font-normal text-emerald-600">
                  XM
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                单价 {order.priceXm} XM，已扣除 5% 手续费
              </p>
            </div>

            <TakeButton
              orderId={order.id}
              status={order.status}
              slotsAvailable={order.slotsAvailable}
              expiresAt={order.expiresAt}
            />

            <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
              抢单成功后需在 3 小时内提交 X 链接，超时名额自动释放并计入违约。
            </p>
          </div>
        </aside>

        <div className="space-y-6 lg:order-1">
          <RequirementsCard order={order} />

          <section className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">名额</h2>
              <span className="text-sm text-slate-500">
                可抢 {order.slotsAvailable} / 共 {order.slotsTotal} 个
              </span>
            </div>

            {order.slots.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                还没有人接单，快来抢首单。
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {order.slots.map((slot) => {
                  const inactive =
                    slot.status === 'expired' || slot.status === 'refunded';
                  return (
                    <li
                      key={slot.id}
                      className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${
                        inactive ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                          {slot.creator.nickname || '匿名用户'}
                          <RatingBadge grade={slot.creator.ratingGrade} />
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          接单 {formatDateTime(slot.acceptedAt)} · 交付截止{' '}
                          {formatDateTime(slot.deliverDeadlineAt)}
                          {slot.deliveredAt
                            ? ` · 已交付 ${formatDateTime(slot.deliveredAt)}`
                            : ''}
                        </p>
                      </div>
                      <span
                        className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${SLOT_STATUS_STYLES[slot.status]}`}
                      >
                        {SLOT_STATUS_LABEL[slot.status]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 text-xs text-slate-400">
              时间均为北京时间（UTC+8）；交付链接仅本人与管理员可见。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center text-sm text-slate-500 transition hover:text-indigo-700"
    >
      ← 返回大厅
    </Link>
  );
}

function RequirementsCard({ order }: { order: OrderDetailView }) {
  const requirements: OrderRequirements = order.requirements ?? {
    keywords: [],
    hashtags: [],
    mentions: [],
    links: [],
  };
  const minChars = requirements.minChars ?? defaultMinChars(order.type);

  return (
    <section className="card space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">交付要求</h2>
        <p className="mt-1 text-xs text-slate-500">
          交付的 X 链接需逐项满足以下要求，自动核验通过后进入结算。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <RequirementGroup label="关键词" values={requirements.keywords ?? []} />
        <RequirementGroup
          label="话题标签"
          values={requirements.hashtags ?? []}
          prefix="#"
        />
        <RequirementGroup
          label="@ 提及"
          values={requirements.mentions ?? []}
          prefix="@"
        />
        <RequirementGroup
          label="要求链接"
          values={requirements.links ?? []}
          linkify
        />
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="text-sm text-slate-600">
          字数下限：
          <span className="font-medium text-slate-900">≥ {minChars} 字符</span>
          {requirements.minChars === undefined ? (
            <span className="text-xs text-slate-400">
              （{ORDER_TYPE_LABEL[order.type]}类默认）
            </span>
          ) : null}
        </p>
      </div>

      {order.targetTweetUrl ? (
        <div className="border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-700">
            {order.type === 'post' ? '参考推文' : '目标推文'}
          </p>
          <a
            href={order.targetTweetUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-1 block break-all text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            {order.targetTweetUrl}
          </a>
          <p className="mt-1 text-xs text-slate-500">
            {order.type === 'comment'
              ? '请在上述推文下发布评论。'
              : order.type === 'quote'
                ? '请引用上述推文发布内容。'
                : '发帖时可参考上述推文。'}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function RequirementGroup({
  label,
  values,
  prefix,
  linkify = false,
}: {
  label: string;
  values: string[];
  prefix?: string;
  linkify?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {values.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">无</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((raw) => {
            const value =
              prefix && !raw.startsWith(prefix) ? `${prefix}${raw}` : raw;
            const isLink = linkify && /^https?:\/\//i.test(value);
            return isLink ? (
              <a
                key={raw}
                href={value}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center break-all rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
              >
                {value}
              </a>
            ) : (
              <span
                key={raw}
                className="inline-flex max-w-full items-center break-all rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
              >
                {value}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <p className="text-sm text-slate-500">正在加载商单详情…</p>
      <div className="card animate-pulse space-y-5">
        <div className="h-4 w-24 rounded bg-slate-100" />
        <div className="h-7 w-2/3 rounded bg-slate-100" />
        <div className="h-3 w-full rounded bg-slate-100" />
        <div className="h-3 w-4/5 rounded bg-slate-100" />
        <div className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-10 rounded bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
