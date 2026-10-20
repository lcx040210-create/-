import Link from 'next/link';
import { payoutOf } from '@/lib/format';
import {
  formatDateTime,
  ORDER_TYPE_LABEL,
  type OrderType,
  type OrderView,
} from '@/lib/orders';
import RatingBadge from './RatingBadge';

const TYPE_STYLES: Record<OrderType, string> = {
  post: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  comment: 'bg-sky-50 text-sky-700 ring-sky-200',
  quote: 'bg-violet-50 text-violet-700 ring-violet-200',
};

interface OrderCardProps {
  order: OrderView;
}

export default function OrderCard({ order }: OrderCardProps) {
  const keywords = order.requirements.keywords ?? [];
  const shownKeywords = keywords.slice(0, 5);
  const hiddenKeywordCount = keywords.length - shownKeywords.length;

  return (
    <Link
      href={`/orders/${order.id}`}
      className="card group flex h-full flex-col gap-4 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_STYLES[order.type]}`}
        >
          {ORDER_TYPE_LABEL[order.type]}
        </span>
        {order.slotsAvailable <= 0 ? (
          <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
            名额已满
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-500">
          招募截止 {formatDateTime(order.expiresAt)}
        </span>
      </div>

      <div>
        <h2 className="line-clamp-2 text-lg font-semibold leading-6 text-slate-900 group-hover:text-indigo-700">
          {order.title}
        </h2>
        <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-slate-600">
          {order.brief}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {shownKeywords.length > 0 ? (
          shownKeywords.map((keyword) => (
            <span
              key={keyword}
              className="inline-flex max-w-full items-center truncate rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            >
              {keyword}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-400">无指定关键词</span>
        )}
        {hiddenKeywordCount > 0 ? (
          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            +{hiddenKeywordCount}
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 border-t border-slate-100 pt-4">
        <div>
          <p className="text-xs text-slate-500">单价</p>
          <p className="mt-0.5 text-lg font-semibold text-slate-900">
            {order.priceXm}
            <span className="ml-1 text-xs font-normal text-slate-500">XM</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-emerald-700">
            到手 {payoutOf(order.priceXm)} XM
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs text-slate-500">剩余名额</p>
          <p className="mt-0.5 text-lg font-semibold text-slate-900">
            {order.slotsAvailable}
            <span className="text-sm font-normal text-slate-400">
              /{order.slotsTotal}
            </span>
          </p>
          <p className="mt-1 flex items-center justify-end gap-1.5 text-xs text-slate-500">
            商家
            <RatingBadge grade={order.merchantRatingGrade} />
          </p>
        </div>
      </div>
    </Link>
  );
}
