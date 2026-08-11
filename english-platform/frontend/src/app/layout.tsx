import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '英语教学平台',
  description: 'PTE/雅思在线教学平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
