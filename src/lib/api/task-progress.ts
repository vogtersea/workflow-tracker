import { requireUserFrom, audit } from '@/lib/auth';
import { getTask, deleteProgress } from '@/lib/tasks';
import { ok, fail } from './http';
import { guard } from './guard';

/**
 * 工作进展记录接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

export function taskProgressDelete(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return fail('工作不存在', 404);

    if (user.role !== 'admin' && existing.owner_id !== user.id)
      return fail('无权操作该工作', 403);

    const url = new URL(req.url);
    const progressId = Number(url.searchParams.get('id'));
    if (!progressId) return fail('缺少进展记录 ID', 400);

    deleteProgress(progressId);
    audit(user.id, 'progress.delete', String(taskId), String(progressId));
    return ok(undefined);
  });
}
