import type { Metadata } from 'next';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: '英语教学平台 — PTE/雅思在线教学',
  description: '严选资深老师，覆盖 PTE Academic、PTE Core、雅思全科，听说读写精准提分',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
