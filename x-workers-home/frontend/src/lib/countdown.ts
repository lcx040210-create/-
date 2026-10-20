/**
 * 倒计时展示纯函数（与后端 3h 交付 / 48h 确认窗口对齐）。
 *
 * 语义：显示「严格小于剩余毫秒数的完整秒数」，因此窗口起点 3h
 * 立即显示 2:59:59；到期（diff <= 0）显示「已超时」。
 */
export interface RemainingText {
  text: string;
  urgent: boolean;
}

export const URGENT_THRESHOLD_MS = 10 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatRemaining(deadlineMs: number, nowMs: number): RemainingText {
  const diff = deadlineMs - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) {
    return { text: '已超时', urgent: true };
  }

  const totalSeconds = Math.floor((diff - 1) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    text: `${hours}:${pad2(minutes)}:${pad2(seconds)}`,
    urgent: diff < URGENT_THRESHOLD_MS,
  };
}
