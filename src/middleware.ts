import { NextResponse, type NextRequest } from 'next/server';
import { IS_LOCAL_BUILD } from '@/lib/runtime-mode';

/**
 * 路由守卫 — 仅做粗粒度重定向，细粒度权限在服务端组件/API 内二次校验
 * 说明：middleware 运行于 Edge Runtime，不能直接查 SQLite，
 * 因此这里只判断 cookie 是否存在；会话有效性由页面/接口自行校验。
 */
export function middleware(req: NextRequest) {
  /**
   * 手机单机版：没有服务端，会话完全在浏览器本地维护，
   * middleware 看不到任何 cookie，若照常判断会把每次页面导航都弹回登录页。
   * 这里直接放行，登录态由各页面的客户端逻辑自行校验（/api/auth/me 走本地库）。
   */
  if (IS_LOCAL_BUILD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has('wt_session');

  /**
   * public 下的静态资源直接放行。
   * 之前只排除了 _next 与 favicon，导致 /sqlite3.wasm 被 307 到登录页，
   * 浏览器拿到的是 HTML 而不是 wasm，报「expected magic word 00 61 73 6d」。
   */
  const isStaticAsset =
    !pathname.startsWith('/api/') && /\.[a-zA-Z0-9]+$/.test(pathname);

  const isPublic =
    isStaticAsset ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/setup') ||
    pathname.startsWith('/api/health') ||
    // 定时任务入口：不用登录态，改用 JOB_TOKEN 头校验（在路由内实现）
    pathname.startsWith('/api/jobs/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon');

  if (isPublic) {
    // 已登录用户访问登录页 → 跳首页
    if (pathname.startsWith('/login') && hasSession) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, error: '未登录或登录已过期' }, { status: 401 });
    }
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
