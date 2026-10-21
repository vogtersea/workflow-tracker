import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { weekBucket, weekTrend, weekStartByOffset } from '@/lib/week';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
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
    const ownerId = restrict !== null ? null : ownerParam && ownerParam !== 'all' ? Number(ownerParam) : null;

    const trendWeeks = Math.min(Math.max(Number(p.get('trend') || 8), 1), 26);

    const bucket = weekBucket(weekStart, {
      restrictToOwner: restrict ?? undefined,
      ownerId
    });
    const trend = weekTrend(trendWeeks, {
      restrictToOwner: restrict ?? undefined,
      ownerId
    });

    return NextResponse.json({ ok: true, data: { bucket, trend } });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[week GET]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '加载失败' },
      { status: 500 }
    );
  }
}
