import { requireUserFrom, audit } from '@/lib/auth';
import {
  generateSingleReport,
  generatePeriodReport,
  saveReport,
  listReports,
  type ReportScope
} from '@/lib/reports';
import { isoWeek, monthRange, yearRange, halfYearRange, today, ymd, parseYmd } from '@/lib/date';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 总结报告列表 / 生成接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

/** 根据 scope 计算区间 */
function resolveRange(scope: ReportScope, p: URLSearchParams) {
  const now = today();
  switch (scope) {
    case 'week': {
      // 支持指定具体某周（week=YYYY-MM-DD，该周任意一天）
      const wParam = p.get('week');
      if (wParam && /^\d{4}-\d{2}-\d{2}$/.test(wParam)) {
        const w = isoWeek(parseYmd(wParam));
        return { start: w.start, end: w.end, label: `${w.label} 周工作总结` };
      }
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

export function reportsGet(req: Request): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    return ok(listReports(100));
  });
}

interface ReportPostBody {
  scope?: ReportScope;
  taskId?: number | string;
  taskTitle?: string;
  title?: string;
  extraInstruction?: string;
  owner_id?: number | string;
}

export function reportsPost(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const url = new URL(req.url);
    const body = await readJson<ReportPostBody>(req);
    const scope = (body.scope || 'week') as ReportScope;

    // 单工作报告
    if (scope === 'single') {
      const taskId = Number(body.taskId);
      if (!taskId) return fail('缺少工作 ID', 400);

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
      return ok({ id, content: r.content, degraded: r.degraded, reason: r.reason });
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
    return ok({
      id,
      content: r.content,
      taskCount: r.taskCount,
      range,
      degraded: r.degraded,
      reason: r.reason
    });
  });
}
