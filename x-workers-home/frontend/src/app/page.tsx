import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import OrderCard from '@/components/OrderCard';
import {
  buildOrderListHref,
  fetchOrderList,
  ORDER_TYPE_LABEL,
  parseOrderListSearchParams,
  type OrderListQuery,
  type OrderListResult,
  type OrderType,
} from '@/lib/orders';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '任务大厅',
};

const TYPE_TABS: Array<{ value?: OrderType; label: string }> = [
  { label: '全部' },
  { value: 'post', label: ORDER_TYPE_LABEL.post },
  { value: 'comment', label: ORDER_TYPE_LABEL.comment },
  { value: 'quote', label: ORDER_TYPE_LABEL.quote },
];

interface HomePageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default function HomePage({ searchParams }: HomePageProps) {
  const query = parseOrderListSearchParams(searchParams);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 px-8 py-10 text-white shadow-lg">
        <p className="mb-2 text-xs font-medium tracking-widest text-indigo-100">
          X WORKERS HOME · 任务大厅
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          挑选商单，按约交付
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-indigo-100">
          免登录浏览招募中的商单。登录并完成 X 绑定后即可抢单，接单后需在 3
          小时内完成交付；到手价已按 5% 手续费折算，验收通过后自动放款。
        </p>
      </section>

      <FilterBar query={query} />

      <Suspense key={buildOrderListHref(query)} fallback={<ListLoading />}>
        <OrderList query={query} />
      </Suspense>

      <p className="text-center text-xs text-slate-400">
        以上时间均为北京时间（UTC+8）。
      </p>
    </div>
  );
}

function FilterBar({ query }: { query: OrderListQuery }) {
  const activeType = query.type ?? null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-slate-500">类型</span>
        {TYPE_TABS.map((tab) => {
          const active = activeType === (tab.value ?? null);
          return (
            <Link
              key={tab.label}
              href={buildOrderListHref({ type: tab.value, sort: query.sort })}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                active
                  ? 'bg-indigo-50 font-medium text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-slate-500">排序</span>
        {[
          { value: 'new' as const, label: '最新' },
          { value: 'price' as const, label: '价格从高到低' },
        ].map((tab) => {
          const active = query.sort === tab.value;
          return (
            <Link
              key={tab.value}
              href={buildOrderListHref({ type: query.type, sort: tab.value })}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                active
                  ? 'bg-indigo-50 font-medium text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

async function OrderList({ query }: { query: OrderListQuery }) {
  let data: OrderListResult;
  try {
    data = await fetchOrderList(query);
  } catch (err) {
    return (
      <div className="card space-y-3 border-red-200 bg-red-50/40" role="alert">
        <h2 className="text-base font-semibold text-red-800">商单加载失败</h2>
        <p className="text-sm text-red-700">
          {err instanceof Error ? err.message : '加载商单失败，请稍后重试'}
        </p>
        <a href={buildOrderListHref(query)} className="btn-secondary w-fit">
          重新加载
        </a>
      </div>
    );
  }

  if (data.items.length === 0) {
    const hasFilters = !!query.type;
    if (data.total > 0 && query.page > 1) {
      return (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-slate-600">这一页没有更多商单了。</p>
          <Link
            href={buildOrderListHref({ ...query, page: 1 })}
            className="btn-secondary mx-auto w-fit"
          >
            返回第 1 页
          </Link>
        </div>
      );
    }
    return (
      <div className="card space-y-3 py-12 text-center">
        <p className="text-base font-medium text-slate-800">
          当前没有招募中的商单
        </p>
        <p className="text-sm text-slate-500">
          {hasFilters
            ? '当前类型下暂无商单，可以换个类型看看。'
            : '商家发布商单后会自动出现在这里，稍后再来看看吧。'}
        </p>
        {hasFilters ? (
          <Link
            href={buildOrderListHref({ sort: query.sort })}
            className="btn-secondary mx-auto w-fit"
          >
            查看全部商单
          </Link>
        ) : null}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        共 {data.total} 张招募中商单 · 第 {query.page} / {totalPages} 页
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {data.items.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>

      {totalPages > 1 ? (
        <nav
          aria-label="分页"
          className="flex items-center justify-center gap-3 pt-2"
        >
          {query.page > 1 ? (
            <Link
              href={buildOrderListHref({ ...query, page: query.page - 1 })}
              className="btn-secondary"
            >
              上一页
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-40">
              上一页
            </span>
          )}

          <span className="text-sm text-slate-600">
            第 {query.page} / {totalPages} 页
          </span>

          {query.page < totalPages ? (
            <Link
              href={buildOrderListHref({ ...query, page: query.page + 1 })}
              className="btn-secondary"
            >
              下一页
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-40">
              下一页
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}

function ListLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <p className="text-sm text-slate-500">正在加载商单…</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="card animate-pulse space-y-4">
            <div className="h-4 w-20 rounded bg-slate-100" />
            <div className="h-5 w-3/4 rounded bg-slate-100" />
            <div className="h-3 w-full rounded bg-slate-100" />
            <div className="h-3 w-2/3 rounded bg-slate-100" />
            <div className="flex justify-between gap-4 border-t border-slate-100 pt-4">
              <div className="h-10 w-24 rounded bg-slate-100" />
              <div className="h-10 w-20 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
