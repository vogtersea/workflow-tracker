/**
 * 双档位构建配置：
 *
 * 服务端档（默认）——Docker / Windows 桌面版 / 服务版
 *   output: 'standalone'，产物自包含，直接 node server.js 运行。
 *
 * 手机本地档（NEXT_PUBLIC_WT_LOCAL=1 且 WT_LOCAL_EXPORT=1）——
 *   纯静态导出，供 Capacitor 打包 APK。全部业务在浏览器内完成，
 *   没有服务端；因此必须满足静态导出的硬性约束：
 *   - 不允许 middleware（构建脚本会把 src/middleware.ts 挪走）
 *   - 不允许动态路由处理程序（构建脚本把 src/app/api 挪走）
 *   - trailingSlash: true 让每个页面生成「目录/index.html」，
 *     对 Capacitor 内置静态服务最友好
 *
 * 仅 NEXT_PUBLIC_WT_LOCAL=1（手机档 dev 调试）时仍走 standalone，
 * 方便本机起 dev 服务器联调本地模式。
 */

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

if (process.env.NEXT_PUBLIC_WT_LOCAL === '1' && process.env.WT_LOCAL_EXPORT === '1') {
  nextConfig.output = 'export';
  nextConfig.trailingSlash = true;
  nextConfig.images = { unoptimized: true };
  // 手机端不需要 standalone 产物，关掉避免多余拷贝
  nextConfig.outputFileTracingRoot = undefined;
}

export default nextConfig;
