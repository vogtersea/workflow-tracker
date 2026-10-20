import { NextResponse } from 'next/server';
import { requireUser, audit, UnauthorizedError } from '@/lib/auth';
import {
  generateSingleReport,
  generatePeriodReport,
  saveReport,
  listReports,
  type ReportScope
} from '@/lib/reports';
import { isoWeek, monthRange, yearRange, halfYearRange, today, ymd } from '@/lib/date';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** 根据 scope 计算区间 */
function resolveRange(scope: ReportScope, p: URLSearchParams) {
  const now = today();
  switch (scope) {
    case 'week': {
      const w = isoWeek(now);
      return { start: w.start, end: w.end, label: `${w.label} 周工作总结` };
    }
    case 'month': {
      const m = monthRange(now);
      return { start: m.start, end: m.end, label: `${m.label}工作总结` };
    }
    case 'half_year': {
      const h = halfYearRange(now);
      return { start: h.start, end: h.end, label: `${h.label}工作总结` };
    }
    case 'year': {
      const y = yearRange(now);
      return { start: y.start, end: y.end, label: `${y.label}工作总结` };
    }
    case 'custom': {
      const s = p.get('start') || ymd(new Date(now.getFullYear(), now.getMonth(), 1));
      const e = p.get('end') || ymd(now);
      return { start: s, end: e, label: `工作总结（${s} 至 ${e}）` };
    }
    default:
      return { start: ymd(now), end: ymd(now), label: '工作总结' };
  }
}

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, data: listReports(100) });
  } catch {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const body = await req.json();
    const scope = (body.scope || 'week') as ReportScope;

    // 单工作报告
    if (scope === 'single') {
      const taskId = Number(body.taskId);
      if (!taskId)
        return NextResponse.json({ ok: false, error: '缺少工作 ID' }, { status: 400 });

      const r = await generateSingleReport(taskId, { extraInstruction: body.extraInstruction });
      const title = body.title || `${body.taskTitle || '单项工作'}总结`;
      const id = saveReport({
        scope: 'single',
        title,
        taskIds: [taskId],
        contentMd: r.content,
        model: r.model,
        createdBy: user.id
      });
      audit(user.id, 'report.generate', String(id), 'single');
      return NextResponse.json({ ok: true, data: { id, content: r.content } });
    }

    const range = resolveRange(scope, url.searchParams);
    const ownerId = user.role === 'admin' ? (body.owner_id ? Number(body.owner_id) : null) : user.id;

    const r = await generatePeriodReport(scope, range.start, range.end, {
      ownerId,
      extraInstruction: body.extraInstruction,
      title: body.title
    });

    const title = body.title || range.label;
    const id = saveReport({
      scope,
      title,
      rangeStart: range.start,
      rangeEnd: range.end,
      contentMd: r.content,
      model: r.model,
      createdBy: user.id
    });

    audit(user.id, 'report.generate', String(id), scope);
    return NextResponse.json({
      ok: true,
      data: { id, content: r.content, taskCount: r.taskCount, range }
    });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[report POST]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '生成失败' },
      { status: 500 }
    );
  }
}
