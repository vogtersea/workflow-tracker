import { NextResponse } from 'next/server';
import { requireUser, audit } from '@/lib/auth';
import { queryTasks, createTask } from '@/lib/tasks';
import { generateFromTemplates } from '@/lib/templates';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const p = url.searchParams;

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
      keyword: p.get('q') || undefined,
      dueFrom: p.get('dueFrom') || undefined,
      dueTo: p.get('dueTo') || undefined,
      limit: Number(p.get('limit') || 200),
      sort: (p.get('sort') as 'due' | 'created' | 'priority' | 'updated') || 'due'
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    console.error('[tasks GET]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '查询失败' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();

    if (!body.title?.trim()) {
      return NextResponse.json({ ok: false, error: '工作名称不能为空' }, { status: 400 });
    }

    // 成员只能给自己建工作
    const ownerId =
      user.role === 'admin' ? (body.owner_id ?? null) : user.id;

    const id = createTask({
      title: body.title,
      detail: body.detail ?? '',
      done_criteria: body.done_criteria ?? '',
      due_date: body.due_date || null,
      priority: body.priority || 'normal',
      owner_id: ownerId,
      tag_ids: Array.isArray(body.tag_ids) ? body.tag_ids : [],
      estimate_hours: body.estimate_hours ?? null,
      created_by: user.id
    });

    audit(user.id, 'task.create', String(id), body.title);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[tasks POST]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '创建失败' },
      { status: 500 }
    );
  }
}
