import Link from 'next/link';

export default function Home() {
  return (
    <main>
      {/* Header */}
      <header className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <span className="text-xl font-bold text-blue-600">英语教学平台</span>
          <div className="flex items-center gap-4">
            <Link href="/app/login" className="text-sm text-gray-500 hover:text-blue-600">登录</Link>
            <Link href="/app/register" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              免费注册
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-5xl font-extrabold text-gray-900 mb-6 leading-tight">
            PTE / 雅思 在线教学<br />
            <span className="text-blue-600">助你冲刺高分</span>
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-10">
            严选资深老师，覆盖 PTE Academic、PTE Core、雅思全科<br />
            听说读写精准提分，灵活约课，随到随学
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/app/register" className="px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 shadow-lg shadow-blue-200">
              立即开始
            </Link>
            <Link href="#packages" className="px-8 py-3 border-2 border-blue-600 text-blue-600 rounded-xl font-semibold text-lg hover:bg-blue-50">
              查看课包
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">为什么选择我们</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: '🎓',
                title: '严选师资',
                desc: '所有老师均通过平台审核，具有丰富的 PTE/雅思教学经验，学生评价透明可见',
              },
              {
                icon: '📅',
                title: '灵活约课',
                desc: '按你的时间表自由预约，提前4小时即可。支持取消，12小时前退课时',
              },
              {
                icon: '📊',
                title: '精准提分',
                desc: '听说读写分项训练，老师根据你的薄弱环节制定专属学习计划',
              },
              {
                icon: '💰',
                title: '透明定价',
                desc: '课包一口价，无隐藏费用。支持微信支付和支付宝，安全便捷',
              },
              {
                icon: '🔄',
                title: 'FIFO 课时管理',
                desc: '最早到期的课时优先使用，分类管理不同科目课时，永不过期浪费',
              },
              {
                icon: '⭐',
                title: '双向评价',
                desc: '学生和老师互相评价，持续提升教学质量，好评老师获额外奖励',
              },
            ].map((f) => (
              <div key={f.title} className="bg-white rounded-2xl border p-8 hover:shadow-lg transition-shadow">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="text-lg font-bold mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Packages */}
      <section id="packages" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">课包选择</h2>
          <p className="text-center text-gray-500 mb-12">灵活套餐，满足不同学习需求</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { name: '入门课包', lessons: 10, price: 2990, desc: '适合试学和短期冲刺', highlight: false },
              { name: '进阶课包', lessons: 20, price: 5490, desc: '系统学习，稳步提升', highlight: true },
              { name: '学霸课包', lessons: 50, price: 12490, desc: '长期备考，性价比最高', highlight: false },
            ].map((pkg) => (
              <div
                key={pkg.name}
                className={`rounded-2xl border p-8 text-center relative ${
                  pkg.highlight
                    ? 'bg-blue-600 text-white border-blue-600 scale-105 shadow-xl'
                    : 'bg-white'
                }`}
              >
                {pkg.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-gray-900 text-xs font-bold px-4 py-1 rounded-full">
                    最受欢迎
                  </span>
                )}
                <h3 className={`text-xl font-bold mb-2 ${pkg.highlight ? 'text-white' : 'text-gray-900'}`}>
                  {pkg.name}
                </h3>
                <p className={`text-sm mb-4 ${pkg.highlight ? 'text-blue-100' : 'text-gray-500'}`}>
                  {pkg.desc}
                </p>
                <div className={`text-4xl font-extrabold mb-2 ${pkg.highlight ? 'text-white' : 'text-gray-900'}`}>
                  ¥{pkg.price.toLocaleString()}
                </div>
                <p className={`text-sm mb-6 ${pkg.highlight ? 'text-blue-100' : 'text-gray-400'}`}>
                  {pkg.lessons} 课时 | 有效期 {pkg.lessons * 9} 天
                </p>
                <Link
                  href="/app/register"
                  className={`block w-full py-3 rounded-xl font-semibold text-sm ${
                    pkg.highlight
                      ? 'bg-white text-blue-600 hover:bg-gray-100'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  立即购买
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">准备好开始了吗？</h2>
          <p className="text-gray-500 mb-8">注册即享首次试听优惠，不满意全额退款</p>
          <Link
            href="/app/register"
            className="px-10 py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 shadow-lg shadow-blue-200 inline-block"
          >
            免费注册
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h4 className="text-white font-bold text-lg mb-3">英语教学平台</h4>
              <p className="text-sm">PTE Academic · PTE Core · 雅思<br />专业在线英语教学</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3">快速链接</h4>
              <div className="space-y-2 text-sm">
                <div><Link href="/app/login" className="hover:text-white">登录</Link></div>
                <div><Link href="/app/register" className="hover:text-white">注册</Link></div>
                <div><Link href="/app/teachers" className="hover:text-white">找老师</Link></div>
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3">联系我们</h4>
              <p className="text-sm">微信号：EnglishPlatform<br />邮箱：admin@platform.com</p>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-700 text-center text-sm">
            © 2026 英语教学平台. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
