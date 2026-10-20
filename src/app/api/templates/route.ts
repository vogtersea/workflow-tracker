import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError } from '@/lib/auth';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateFromTemplates
} from '@/lib/templates';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, data: listTemplates() });
  } catch {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();

    if (!body.title?.trim())
      return NextResponse.json({ ok: false, error: '模板名称不能为空' }, { status: 400 });
    if (!['weekly', 'monthly'].includes(body.cadence))
      return NextResponse.json({ ok: false, error: '周期类型不合法' }, { status: 400 });

    const id = createTemplate({
      title: body.title,
      detail: body.detail ?? '',
      done_criteria: body.done_criteria ?? '',
      cadence: body.cadence,
      weekday: body.cadence === 'weekly' ? Number(body.weekday ?? 5) : null,
      month_day: body.cadence === 'monthly' ? Number(body.month_day ?? 25) : null,
      due_offset: Number(body.due_offset ?? 0),
      priority: body.priority || 'normal',
      owner_id: user.role === 'admin' ? (body.owner_id ?? null) : user.id,
      tag_ids: Array.isArray(body.tag_ids) ? body.tag_ids : []
    });

    audit(user.id, 'template.create', String(id), body.title);

    // 立即尝试生成一次实例
    const gen = generateFromTemplates();
    return NextResponse.json({ ok: true, data: { id, generated: gen.generated, details: gen.details } });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[template POST]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '创建失败' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body.id) return NextResponse.json({ ok: false, error: '缺少模板 ID' }, { status: 400 });
    updateTemplate(Number(body.id), body);
    audit(user.id, 'template.update', String(body.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '更新失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return NextResponse.json({ ok: false, error: '缺少模板 ID' }, { status: 400 });
    deleteTemplate(id);
    audit(user.id, 'template.delete', String(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}

/** 手动触发生成 */
export async function PUT() {
  try {
    await requireUser();
    const r = generateFromTemplates();
    return NextResponse.json({ ok: true, data: r });
  } catch {
    return NextResponse.json({ ok: false, error: '生成失败' }, { status: 500 });
  }
}
