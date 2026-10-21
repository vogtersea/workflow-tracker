/**
 * 服务端启动钩子
 *
 * 业务模块统一从 db-registry 取库，而 node:sqlite 的实现在 db.ts 里。
 * 只要有任何模块 import 了 db.ts 就会注册，但「有没有人 import」不该靠运气：
 * 这里在 Node 运行时启动时主动求值一次。
 *
 * 注意：不能只判断 NEXT_RUNTIME === 'nodejs'——dev 模式下该变量未必就绪，
 * 这里改成「不是 edge 就是 node」，边缘运行时不加载 node:sqlite。
 * 各 API 路由另有一道显式 import 兜底，两重保险。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'edge') {
    await import('@/lib/db');
  }
}
