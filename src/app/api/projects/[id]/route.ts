import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError } from '@/lib/auth';
import { updateProject, getProject, deleteProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const pid = Number(id);
    if (!pid) return NextResponse.json({ ok: false, error: '缺少项目 ID' }, { status: 400 });

    const body = await req.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (!n) return NextResponse.json({ ok: false, error: '项目名称不能为空' }, { status: 400 });
      patch.name = n;
    }
    if (typeof body.description === 'string') patch.description = body.description;
    if (typeof body.color === 'string') patch.color = body.color;
    if (body.status === 'active' || body.status === 'archived') patch.status = body.status;

    try {
      updateProject(pid, patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE|constraint/i.test(msg))
        return NextResponse.json({ ok: false, error: '已存在同名项目' }, { status: 400 });
      throw e;
    }

    audit(user.id, 'project.update', String(pid), String(patch.name ?? ''));
    return NextResponse.json({ ok: true, data: getProject(pid) });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[projects PATCH]', e);
    return NextResponse.json({ ok: false, error: '保存失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const pid = Number(id);
    if (!pid) return NextResponse.json({ ok: false, error: '缺少项目 ID' }, { status: 400 });

    // 直接走库删除；工作本身不删，仅解除项目归属（ON DELETE SET NULL）
    deleteProject(pid);

    audit(user.id, 'project.delete', String(pid));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[projects DELETE]', e);
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}
