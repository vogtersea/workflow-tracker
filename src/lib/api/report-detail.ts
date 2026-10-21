import { requireUserFrom } from '@/lib/auth';
import { getReport, deleteReport } from '@/lib/reports';
import { getDb } from '@/lib/db-registry';
import { ok, fail, json, readJson } from './http';
import { guard } from './guard';

/**
 * 单份报告详情接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」「从动态段取 id」改成从入参取，从而能在浏览器里直接调用。
 */

export function reportGet(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    const r = getReport(Number(id));
    if (!r) return fail('报告不存在', 404);
    return ok(r);
  });
}

export function reportPatch(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const reportId = Number(id);
    const r = getReport(reportId) as { id: number; created_by: number | null } | undefined;
    if (!r) return fail('报告不存在', 404);

    if (user.role !== 'admin' && r.created_by !== user.id) return fail('无权修改该报告', 403);

    const body = await readJson<Record<string, unknown>>(req);
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
    if (!fields.length) return fail('无可更新字段', 400);

    params.push(reportId);
    getDb().prepare(`UPDATE reports SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return json({ ok: true });
  });
}

export function reportDelete(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    deleteReport(Number(id));
    return json({ ok: true });
  });
}
