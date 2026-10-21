import { requireUserFrom, audit } from '@/lib/auth';
import {
  listNotifications,
  markSeen,
  runReminderJob,
  getReminderConfig,
  scanDueTasks
} from '@/lib/reminders';
import { ok, fail, json, readJson } from './http';
import { guard } from './guard';

/**
 * 通知接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

export function notificationsGet(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode');

    if (mode === 'scan') {
      // 仅扫描，不落库（用于前端预览）
      const items = scanDueTasks();
      return ok(items);
    }

    const list = listNotifications(user.id, user.role === 'admin');
    return ok({ items: list, config: getReminderConfig() });
  });
}

/** 标记已读 */
export function notificationsPost(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const body = await readJson<{ action?: string; ids?: number[] | 'all' }>(req);
    if (body.action === 'markSeen') {
      markSeen(body.ids === 'all' ? 'all' : (body.ids as number[]), user.id, user.role === 'admin');
      return json({ ok: true });
    }
    if (body.action === 'runJob') {
      const r = await runReminderJob();
      audit(user.id, 'reminder.run', undefined, JSON.stringify(r));
      return ok(r);
    }
    return fail('未知操作', 400);
  });
}
