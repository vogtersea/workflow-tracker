import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError } from '@/lib/auth';
import { listTags, createTag, deleteTag } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, data: listTags() });
  } catch {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const name = (body.name || '').trim();
    if (!name) return NextResponse.json({ ok: false, error: '标签名称不能为空' }, { status: 400 });
    if (name.length > 20)
      return NextResponse.json({ ok: false, error: '标签名称不超过 20 个字符' }, { status: 400 });

    const id = createTag(name, body.color || '#b91c1c');
    audit(user.id, 'tag.create', String(id), name);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '创建失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return NextResponse.json({ ok: false, error: '缺少标签 ID' }, { status: 400 });

    deleteTag(id);
    audit(user.id, 'tag.delete', String(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}
