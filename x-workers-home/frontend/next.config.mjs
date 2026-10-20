/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker 部署使用 standalone 产物（.next/standalone/server.js + 精简 node_modules）。
  output: 'standalone',
  experimental: {
    // next/og 的 node 包在运行时会按模块相对路径读取内置字体与 wasm；
    // nft 无法静态发现这些资源，standalone 部署需显式随 OG 路由一起拷贝。
    outputFileTracingIncludes: {
      '/api/og/order/[id]': ['./node_modules/next/dist/compiled/@vercel/og/**/*'],
      '/api/og/u/[id]': ['./node_modules/next/dist/compiled/@vercel/og/**/*'],
    },
  },
};

export default nextConfig;
