import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { getTask, updateTask, deleteTask, addProgress, deleteProgress } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 权限校验：管理员可操作全部，成员仅限自己负责的工作 */
function canAccess(
  user: { id: number; role: string },
  ownerId: number | null
): boolean {
  if (user.role === 'admin') return true;
  return ownerId === user.id;
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const task = getTask(Number(id));
    if (!task) return NextResponse.json({ ok: false, error: '工作不存在' }, { status: 404 });
    if (!canAccess(user, task.owner_id))
      return NextResponse.json({ ok: false, error: '无权查看该工作' }, { status: 403 });
    return NextResponse.json({ ok: true, data: task });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '查询失败' }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return NextResponse.json({ ok: false, error: '工作不存在' }, { status: 404 });
    if (!canAccess(user, existing.owner_id))
      return NextResponse.json({ ok: false, error: '无权修改该工作' }, { status: 403 });

    const body = await req.json();

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
      'tag_ids'
    ];
    for (const f of fields) {
      if (f in body) payload[f] = body[f];
    }

    updateTask(taskId, payload as never);
    audit(user.id, 'task.update', String(taskId), JSON.stringify(Object.keys(payload)));
    return NextResponse.json({ ok: true, data: getTask(taskId) });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[task PATCH]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '更新失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return NextResponse.json({ ok: false, error: '工作不存在' }, { status: 404 });
    if (!canAccess(user, existing.owner_id))
      return NextResponse.json({ ok: false, error: '无权删除该工作' }, { status: 403 });

    deleteTask(taskId);
    audit(user.id, 'task.delete', String(taskId), existing.title);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}

/** 追加进展记录 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return NextResponse.json({ ok: false, error: '工作不存在' }, { status: 404 });
    if (!canAccess(user, existing.owner_id))
      return NextResponse.json({ ok: false, error: '无权操作该工作' }, { status: 403 });

    const body = await req.json();
    if (!body.content?.trim()) {
      return NextResponse.json({ ok: false, error: '进展内容不能为空' }, { status: 400 });
    }

    const percent =
      body.percent === '' || body.percent === null || body.percent === undefined
        ? null
        : Math.max(0, Math.min(100, Number(body.percent)));

    addProgress(taskId, body.content.trim(), percent, user.id);
    audit(user.id, 'progress.add', String(taskId));
    return NextResponse.json({ ok: true, data: getTask(taskId) });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '添加失败' }, { status: 500 });
  }
}
