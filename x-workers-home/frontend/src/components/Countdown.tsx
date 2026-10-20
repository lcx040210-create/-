'use client';

import { useEffect, useState } from 'react';
import { formatRemaining } from '@/lib/countdown';

interface CountdownProps {
  /** ISO 时间串或毫秒时间戳。 */
  deadline: string | number;
  className?: string;
}

/** 每秒走动的倒计时；< 10 分钟标红，到期显示「已超时」。 */
export default function Countdown({ deadline, className = '' }: CountdownProps) {
  const deadlineMs =
    typeof deadline === 'number' ? deadline : new Date(deadline).getTime();
  // 初始为 null：避免 SSR 与客户端时间不一致导致的 hydration 警告。
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (now === null || !Number.isFinite(deadlineMs)) {
    return <span className={`tabular-nums text-slate-400 ${className}`}>—:—:—</span>;
  }

  const { text, urgent } = formatRemaining(deadlineMs, now);
  return (
    <span
      className={`tabular-nums ${
        urgent ? 'font-medium text-rose-600' : 'text-slate-700'
      } ${className}`}
    >
      {text}
    </span>
  );
}
