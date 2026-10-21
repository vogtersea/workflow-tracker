import { userFromRequest } from '@/lib/auth';
import { dashboardStats } from '@/lib/tasks';
import { unseenCount, syncNotifications } from '@/lib/reminders';
import { ok, fail } from './http';
import { guard } from './guard';

/**
 * 顶栏徽标接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从平台解析当前用户」改成从入参 req 取，从而能在浏览器里直接调用。
 *
 * 注意：内部仍保留一层 try/catch —— 徽标失败不应拖垮整个页面，
 * 原逻辑就是在出错时返回全 0 而非报错，这里原样保留。
 */

export function badgesGet(req: Request): Promise<Response> {
  return guard(async () => {
    const user = userFromRequest(req);
    if (!user) return fail('未登录', 401);

    try {
      syncNotifications();
      const scope = user.role === 'admin' ? null : user.id;
      const stats = dashboardStats(scope);
      return ok({
        unseen: unseenCount(user.id, user.role === 'admin'),
        overdue: stats.overdue,
        dueSoon: stats.dueSoon,
        open: stats.open
      });
    } catch (e) {
      console.error('[badges]', e);
      return ok({ unseen: 0, overdue: 0, dueSoon: 0, open: 0 });
    }
  });
}
