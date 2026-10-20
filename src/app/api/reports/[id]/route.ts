import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { getReport, deleteReport } from '@/lib/reports';
import { getDb } from '@/lib/db';
import { markdownToDocx } from '@/lib/export';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const r = getReport(Number(id));
    if (!r) return NextResponse.json({ ok: false, error: '报告不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, data: r });
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
    const reportId = Number(id);
    const r = getReport(reportId) as { id: number; created_by: number | null } | undefined;
    if (!r) return NextResponse.json({ ok: false, error: '报告不存在' }, { status: 404 });

    if (user.role !== 'admin' && r.created_by !== user.id)
      return NextResponse.json({ ok: false, error: '无权修改该报告' }, { status: 403 });

    const body = await req.json();
    const fields: string[] = [];
    const params: unknown[] = [];

    if (typeof body.content_md === 'string') {
      fields.push('content_md = ?');
      params.push(body.content_md);
    }
    if (typeof body.title === 'string' && body.title.trim()) {
      fields.push('title = ?');
      params.push(body.title.trim());
    }
    if (!fields.length) return NextResponse.json({ ok: false, error: '无可更新字段' }, { status: 400 });

    params.push(reportId);
    getDb().prepare(`UPDATE reports SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[report PATCH]', e);
    return NextResponse.json({ ok: false, error: '保存失败' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    deleteReport(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}
