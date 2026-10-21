import { queryTasks, createTask } from '@/lib/tasks';
import { generateFromTemplates } from '@/lib/templates';
import { requireUserFrom, audit } from '@/lib/auth';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 工作列表接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

export function tasksGet(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const p = new URL(req.url).searchParams;

    // 惰性生成周期工作
    try {
      generateFromTemplates();
    } catch (e) {
      console.error('[templates]', e);
    }

    const statusParam = (p.get('status') || 'open') as 'open' | 'done' | 'archived' | 'all';
    const ownerParam = p.get('owner');
    const restrict = user.role === 'admin' ? null : user.id;
    const ownerId =
      restrict !== null ? null : ownerParam && ownerParam !== 'all' ? Number(ownerParam) : null;

    const result = queryTasks({
      status: statusParam,
      restrictToOwner: restrict ?? undefined,
      ownerId,
      tagId: p.get('tag') ? Number(p.get('tag')) : undefined,
      projectId: p.get('project') !== null ? Number(p.get('project')) : undefined,
      keyword: p.get('q') || undefined,
      dueFrom: p.get('dueFrom') || undefined,
      dueTo: p.get('dueTo') || undefined,
      limit: Number(p.get('limit') || 200),
      sort: (p.get('sort') as 'due' | 'created' | 'priority' | 'updated') || 'due'
    });

    return ok(result);
  });
}

export function tasksPost(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const body = await readJson<{
      title?: string;
      detail?: string;
      done_criteria?: string;
      due_date?: string;
      priority?: string;
      owner_id?: number | null;
      tag_ids?: number[];
      estimate_hours?: number | null;
      project_id?: number | null;
    }>(req);

    if (!body.title?.trim()) return fail('工作名称不能为空', 400);

    // 成员只能给自己建工作
    const ownerId = user.role === 'admin' ? (body.owner_id ?? null) : user.id;

    const id = createTask({
      title: body.title,
      detail: body.detail ?? '',
      done_criteria: body.done_criteria ?? '',
      due_date: body.due_date || null,
      priority: body.priority || 'normal',
      owner_id: ownerId,
      tag_ids: Array.isArray(body.tag_ids) ? body.tag_ids : [],
      estimate_hours: body.estimate_hours ?? null,
      project_id: body.project_id ?? null,
      created_by: user.id
    });

    audit(user.id, 'task.create', String(id), body.title);
    return ok({ id });
  });
}
