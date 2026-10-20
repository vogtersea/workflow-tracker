/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // 默认 .next；某些环境对 .next 有写入限制时，可用 NEXT_DIST_DIR 换目录
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // 类型检查已打开：tsc --noEmit 零错误，闸门开着几乎零成本
  typescript: { ignoreBuildErrors: false },
  // 仓库未引入 ESLint 依赖与配置，这里保持跳过，否则 next build 会卡在交互式初始化；
  // 需要代码风格约束时补 eslint + eslint-config-next，再把此开关改为 false
  eslint: { ignoreDuringBuilds: true }
};

export default nextConfig;
