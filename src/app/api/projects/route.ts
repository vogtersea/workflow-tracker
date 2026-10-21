import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError } from '@/lib/auth';
import { listProjects, createProject, deleteProject, getProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (id) {
      const p = getProject(Number(id));
      if (!p) return NextResponse.json({ ok: false, error: '项目不存在' }, { status: 404 });
      return NextResponse.json({ ok: true, data: p });
    }
    const includeArchived = url.searchParams.get('all') === '1';
    return NextResponse.json({ ok: true, data: listProjects({ includeArchived }) });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[projects GET]', e);
    return NextResponse.json({ ok: false, error: '加载失败' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const name = (body.name || '').trim();
    if (!name) return NextResponse.json({ ok: false, error: '项目名称不能为空' }, { status: 400 });
    if (name.length > 40)
      return NextResponse.json({ ok: false, error: '项目名称不超过 40 个字符' }, { status: 400 });

    let id: number;
    try {
      id = createProject({ name, description: body.description || '', color: body.color || '#7f1d1d' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE|constraint/i.test(msg))
        return NextResponse.json({ ok: false, error: '已存在同名项目' }, { status: 400 });
      throw e;
    }

    audit(user.id, 'project.create', String(id), name);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[projects POST]', e);
    return NextResponse.json({ ok: false, error: '创建失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return NextResponse.json({ ok: false, error: '缺少项目 ID' }, { status: 400 });

    deleteProject(id);
    audit(user.id, 'project.delete', String(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[projects DELETE]', e);
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}
