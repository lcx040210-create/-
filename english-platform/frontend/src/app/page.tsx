import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold">英语教学平台</h1>
      <p className="text-gray-500">PTE / 雅思 在线教学</p>
      <div className="flex gap-4">
        <Link href="/app/login" className="px-6 py-2 bg-blue-600 text-white rounded-lg">
          登录
        </Link>
        <Link href="/app/register" className="px-6 py-2 border border-blue-600 text-blue-600 rounded-lg">
          注册
        </Link>
      </div>
    </main>
  );
}
