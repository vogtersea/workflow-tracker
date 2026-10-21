import { UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { fail } from './http';

/**
 * API 处理函数统一错误边界
 *
 * 未登录 → 401，无权限 → 403，其余 → 500 并把原始信息回给前端。
 * 服务端 route.ts 与手机端本地路由共用，保证两端错误语义一致。
 */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail(e.message, 401);
    if (e instanceof ForbiddenError) return fail(e.message, 403);
    const msg = e instanceof Error ? e.message : '服务器内部错误';
    console.error('[api error]', msg, e);
    return fail(msg, 500);
  }
}

/** 仅服务端才需要的额外处理（初始化种子账号、启动后台循环等） */
export function isServerRuntime(): boolean {
  return typeof window === 'undefined';
}
