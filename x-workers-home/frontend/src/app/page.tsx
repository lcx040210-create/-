import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 px-8 py-14 text-white shadow-lg">
        <p className="mb-3 text-sm font-medium tracking-widest text-indigo-100">
          X WORKERS HOME
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          X 工作者之家
        </h1>
        <p className="mt-4 max-w-xl text-indigo-100">
          连接你的 X 账号，承接任务、提交链接、按约结算。所有金额与进度公开透明。
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
          >
            登录 / 注册
          </Link>
          <Link
            href="/me"
            className="rounded-lg border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            我的账户
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: '承接任务',
            desc: '浏览大厅任务，按要求完成并提交 X 链接。',
          },
          {
            title: '按约结算',
            desc: '验收通过后自动入账，手续费与到手价一目了然。',
          },
          {
            title: '信誉积累',
            desc: '绑定 X 账号，积累评分等级，解锁更多任务。',
          },
        ].map((item) => (
          <div key={item.title} className="card">
            <h2 className="text-base font-semibold text-slate-900">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
