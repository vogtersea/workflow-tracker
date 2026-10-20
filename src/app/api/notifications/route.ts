import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError } from '@/lib/auth';
import {
  listNotifications,
  markSeen,
  runReminderJob,
  getReminderConfig,
  scanDueTasks
} from '@/lib/reminders';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode');

    if (mode === 'scan') {
      // 仅扫描，不落库（用于前端预览）
      const items = scanDueTasks();
      return NextResponse.json({ ok: true, data: items });
    }

    const list = listNotifications(user.id, user.role === 'admin');
    return NextResponse.json({
      ok: true,
      data: { items: list, config: getReminderConfig() }
    });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '查询失败' }, { status: 500 });
  }
}

/** 标记已读 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (body.action === 'markSeen') {
      markSeen(body.ids === 'all' ? 'all' : (body.ids as number[]), user.id, user.role === 'admin');
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'runJob') {
      const r = await runReminderJob();
      audit(user.id, 'reminder.run', undefined, JSON.stringify(r));
      return NextResponse.json({ ok: true, data: r });
    }
    return NextResponse.json({ ok: false, error: '未知操作' }, { status: 400 });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '操作失败' }, { status: 500 });
  }
}
