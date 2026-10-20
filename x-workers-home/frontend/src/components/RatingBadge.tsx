const GRADE_STYLES: Record<string, string> = {
  S: 'bg-amber-100 text-amber-800 ring-amber-300',
  A: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  B: 'bg-sky-100 text-sky-800 ring-sky-300',
  C: 'bg-slate-100 text-slate-700 ring-slate-300',
  D: 'bg-rose-100 text-rose-800 ring-rose-300',
};

interface RatingBadgeProps {
  grade: string | null | undefined;
}

/** S/A/B/C/D 评级徽章；无评级时展示中性占位。 */
export default function RatingBadge({ grade }: RatingBadgeProps) {
  if (!grade) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
        暂无评级
      </span>
    );
  }

  const normalized = grade.toUpperCase();
  const style =
    GRADE_STYLES[normalized] ?? 'bg-slate-100 text-slate-700 ring-slate-300';

  return (
    <span
      title={`评级 ${normalized}`}
      aria-label={`评级 ${normalized}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${style}`}
    >
      {normalized}
    </span>
  );
}
