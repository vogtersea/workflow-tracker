import { requireUserFrom, audit } from '@/lib/auth';
import { getTask, updateTask, deleteTask, addProgress } from '@/lib/tasks';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 单个工作接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

/** 权限校验：管理员可操作全部，成员仅限自己负责的工作 */
function canAccess(user: { id: number; role: string }, ownerId: number | null): boolean {
  if (user.role === 'admin') return true;
  return ownerId === user.id;
}

export function taskDetailGet(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const task = getTask(Number(id));
    if (!task) return fail('工作不存在', 404);
    if (!canAccess(user, task.owner_id)) return fail('无权查看该工作', 403);
    return ok(task);
  });
}

export function taskDetailPatch(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return fail('工作不存在', 404);
    if (!canAccess(user, existing.owner_id)) return fail('无权修改该工作', 403);

    const body = await readJson<Record<string, unknown>>(req);

    // 成员不能把工作转派给别人
    if (user.role !== 'admin' && body.owner_id !== undefined) {
      delete body.owner_id;
    }

    const payload: Record<string, unknown> = {};
    const fields = [
      'title',
      'detail',
      'done_criteria',
      'due_date',
      'priority',
      'status',
      'owner_id',
      'estimate_hours',
      'actual_hours',
      'tag_ids',
      'project_id'
    ];
    for (const f of fields) {
      if (f in body) payload[f] = body[f];
    }

    updateTask(taskId, payload as never);
    audit(user.id, 'task.update', String(taskId), JSON.stringify(Object.keys(payload)));
    return ok(getTask(taskId));
  });
}

export function taskDetailDelete(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return fail('工作不存在', 404);
    if (!canAccess(user, existing.owner_id)) return fail('无权删除该工作', 403);

    deleteTask(taskId);
    audit(user.id, 'task.delete', String(taskId), existing.title);
    return ok(undefined);
  });
}

/** 追加进展记录 */
export function taskDetailPost(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return fail('工作不存在', 404);
    if (!canAccess(user, existing.owner_id)) return fail('无权操作该工作', 403);

    const body = await readJson<{ content?: string; percent?: number | string | null }>(req);
    if (!body.content?.trim()) {
      return fail('进展内容不能为空', 400);
    }

    const percent =
      body.percent === '' || body.percent === null || body.percent === undefined
        ? null
        : Math.max(0, Math.min(100, Number(body.percent)));

    addProgress(taskId, body.content.trim(), percent, user.id);
    audit(user.id, 'progress.add', String(taskId));
    return ok(getTask(taskId));
  });
}
