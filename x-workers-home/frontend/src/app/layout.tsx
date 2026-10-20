import type { Metadata } from 'next';
import SiteNav from '@/components/SiteNav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'X工作者之家',
    template: '%s · X工作者之家',
  },
  description: 'X 工作者之家 —— 连接 X 账号，承接任务，按约结算。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <SiteNav />
        <main className="mx-auto w-full max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
