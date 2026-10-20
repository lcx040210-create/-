'use client';

interface StarsProps {
  value: number;
  onChange?: (score: number) => void;
  disabled?: boolean;
  label?: string;
}

const SCORES = [1, 2, 3, 4, 5];

/** 1-5 星评分输入；不传 onChange 时作为只读展示。 */
export default function Stars({
  value,
  onChange,
  disabled = false,
  label = '评分',
}: StarsProps) {
  const readonly = !onChange;

  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {SCORES.map((score) => {
        const active = score <= value;
        return (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${score} 星`}
            disabled={disabled || readonly}
            onClick={() => onChange?.(score)}
            className={`text-xl leading-none transition ${
              active ? 'text-amber-500' : 'text-slate-300'
            } ${readonly ? 'cursor-default' : 'hover:text-amber-400'} ${
              disabled ? 'cursor-not-allowed opacity-50' : ''
            }`}
          >
            {active ? '★' : '☆'}
          </button>
        );
      })}
    </div>
  );
}
