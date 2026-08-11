interface SkeletonProps {
  className?: string;
  /** Preset shapes */
  variant?: 'text' | 'title' | 'card' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
}

const presets = {
  text: 'h-4 w-full rounded-md',
  title: 'h-6 w-3/4 rounded-lg',
  card: 'h-48 w-full rounded-2xl',
  circle: 'h-12 w-12 rounded-full',
  rect: 'h-24 w-full rounded-xl',
};

export default function Skeleton({ className = '', variant, width, height }: SkeletonProps) {
  const presetClass = variant ? presets[variant] : '';
  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`skeleton ${presetClass} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** Group of skeleton lines simulating a paragraph */
export function SkeletonParagraph({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} variant="text" className={i === lines - 1 ? 'w-2/3' : ''} />
      ))}
    </div>
  );
}

/** Card skeleton with image + text */
export function SkeletonCard() {
  return (
    <div className="card p-5 space-y-4">
      <Skeleton variant="title" />
      <SkeletonParagraph lines={3} />
      <div className="flex gap-3 pt-2">
        <Skeleton width={80} height={36} />
        <Skeleton width={80} height={36} />
      </div>
    </div>
  );
}
