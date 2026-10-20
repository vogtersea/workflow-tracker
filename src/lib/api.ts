import { NextResponse } from 'next/server';
import { UnauthorizedError, ForbiddenError } from './auth';

/** 统一 API 响应包装 */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** 统一异常处理：未登录 401、无权限 403、其余 500 */
export function api(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e: unknown) {
      if (e instanceof UnauthorizedError) return fail(e.message, 401);
      if (e instanceof ForbiddenError) return fail(e.message, 403);
      const msg = e instanceof Error ? e.message : '服务器内部错误';
      console.error('[api error]', msg, e);
      return fail(msg, 500);
    }
  };
}
