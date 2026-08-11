'use client';
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  };

  const colors: Record<ToastType, string> = {
    success: 'bg-success-50 border-success-500 text-success-700',
    error: 'bg-red-50 border-red-500 text-red-700',
    info: 'bg-primary-50 border-primary-500 text-primary-700',
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto animate-slide-up flex items-center gap-2 px-4 py-3 rounded-xl border-l-4 shadow-lg bg-white ${colors[t.type]}`}
            onClick={() => removeToast(t.id)}
          >
            <span className="font-bold text-sm">{icons[t.type]}</span>
            <span className="text-sm font-medium">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
