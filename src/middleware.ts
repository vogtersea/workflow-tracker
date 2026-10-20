import { NextResponse, type NextRequest } from 'next/server';

/**
 * 路由守卫 — 仅做粗粒度重定向，细粒度权限在服务端组件/API 内二次校验
 * 说明：middleware 运行于 Edge Runtime，不能直接查 SQLite，
 * 因此这里只判断 cookie 是否存在；会话有效性由页面/接口自行校验。
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has('wt_session');

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/login') ||
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
