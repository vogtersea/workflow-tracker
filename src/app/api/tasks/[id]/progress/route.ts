import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError } from '@/lib/auth';
import { getTask, deleteProgress } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const taskId = Number(id);
    const existing = getTask(taskId);
    if (!existing) return NextResponse.json({ ok: false, error: '工作不存在' }, { status: 404 });

    if (user.role !== 'admin' && existing.owner_id !== user.id)
      return NextResponse.json({ ok: false, error: '无权操作该工作' }, { status: 403 });

    const url = new URL(req.url);
    const progressId = Number(url.searchParams.get('id'));
    if (!progressId)
      return NextResponse.json({ ok: false, error: '缺少进展记录 ID' }, { status: 400 });

    deleteProgress(progressId);
    audit(user.id, 'progress.delete', String(taskId), String(progressId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[progress DELETE]', e);
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}
