import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { dashboardStats } from '@/lib/tasks';
import { unseenCount, syncNotifications } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });

  try {
    syncNotifications();
    const scope = user.role === 'admin' ? null : user.id;
    const stats = dashboardStats(scope);
    return NextResponse.json({
      ok: true,
      data: {
        unseen: unseenCount(user.id, user.role === 'admin'),
        overdue: stats.overdue,
        dueSoon: stats.dueSoon,
        open: stats.open
      }
    });
  } catch (e) {
    console.error('[badges]', e);
    return NextResponse.json({ ok: true, data: { unseen: 0, overdue: 0, dueSoon: 0, open: 0 } });
  }
}
