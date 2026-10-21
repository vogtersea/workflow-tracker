import { requireUserFrom } from '@/lib/auth';
import { weekBucket, weekTrend, weekStartByOffset } from '@/lib/week';
import { ok } from './http';
import { guard } from './guard';

/**
 * 周视图接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

export function weekGet(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const url = new URL(req.url);
    const p = url.searchParams;

    // offset：0 本周，-1 上周，1 下周；也可用 start=YYYY-MM-DD 指定具体某周
    const offsetParam = p.get('offset');
    const startParam = p.get('start');
    const weekStart =
      startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam)
        ? startParam
        : weekStartByOffset(offsetParam !== null ? Number(offsetParam) : 0);

    const restrict = user.role === 'admin' ? null : user.id;
    const ownerParam = p.get('owner');
    const ownerId =
      restrict !== null ? null : ownerParam && ownerParam !== 'all' ? Number(ownerParam) : null;

    const trendWeeks = Math.min(Math.max(Number(p.get('trend') || 8), 1), 26);

    const bucket = weekBucket(weekStart, {
      restrictToOwner: restrict ?? undefined,
      ownerId
    });
    const trend = weekTrend(trendWeeks, {
      restrictToOwner: restrict ?? undefined,
      ownerId
    });

    return ok({ bucket, trend });
  });
}
