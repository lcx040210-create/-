'use client';

import { useEffect, useRef, useState } from 'react';

interface CopyButtonProps {
  /** 要复制的文本；省略时复制当前页面 URL（分享主页）。 */
  text?: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

type CopyState = 'idle' | 'copied' | 'error';

/** 复制到剪贴板：优先 Clipboard API，不可用时回落到隐藏 textarea。 */
async function copyText(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // 权限被拒时继续尝试兜底方案
    }
  }

  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export default function CopyButton({
  text,
  label = '复制链接',
  copiedLabel = '已复制',
  className = 'btn-secondary',
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy() {
    const value =
      text ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!value) return;

    const ok = await copyText(value);
    setState(ok ? 'copied' : 'error');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void handleCopy()}
      aria-live="polite"
    >
      {state === 'copied' ? copiedLabel : state === 'error' ? '复制失败，请手动复制' : label}
    </button>
  );
}
