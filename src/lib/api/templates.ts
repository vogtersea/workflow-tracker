import { requireUserFrom, userFromRequest, audit } from '@/lib/auth';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateFromTemplates,
  CADENCE_LABEL,
  type Cadence
} from '@/lib/templates';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 周期模板接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

const CADENCES = Object.keys(CADENCE_LABEL) as Cadence[];

export function templatesGet(req: Request): Promise<Response> {
  return guard(async () => {
    const user = userFromRequest(req);
    if (!user) return fail('未登录', 401);
    return ok(listTemplates());
  });
}

export function templatesPost(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const body = await readJson<Record<string, any>>(req);

    if (!body.title?.trim()) return fail('模板名称不能为空', 400);
    if (!CADENCES.includes(body.cadence)) return fail('周期类型不合法', 400);

    const id = createTemplate({
      title: body.title,
      detail: body.detail ?? '',
      done_criteria: body.done_criteria ?? '',
      cadence: body.cadence,
      weekday: body.cadence === 'weekly' ? Number(body.weekday ?? 5) : null,
      month_day: body.cadence === 'daily' ? null : Number(body.month_day ?? 28),
      month_no: body.cadence === 'yearly' ? Number(body.month_no ?? 12) : null,
      due_offset: Number(body.due_offset ?? 0),
      priority: body.priority || 'normal',
      owner_id: user.role === 'admin' ? (body.owner_id ?? null) : user.id,
      tag_ids: Array.isArray(body.tag_ids) ? body.tag_ids : []
    });

    audit(user.id, 'template.create', String(id), body.title);

    // 新建后立即生成本周期实例：例行工作创建即有，不必等到进入提醒窗口
    const gen = generateFromTemplates({ force: true, templateId: id });
    return ok({ id, generated: gen.generated, details: gen.details });
  });
}

export function templatesPatch(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const body = await readJson<Record<string, any>>(req);
    if (!body.id) return fail('缺少模板 ID', 400);
    updateTemplate(Number(body.id), body);
    audit(user.id, 'template.update', String(body.id));
    return ok(undefined);
  });
}

export function templatesDelete(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return fail('缺少模板 ID', 400);
    deleteTemplate(id);
    audit(user.id, 'template.delete', String(id));
    return ok(undefined);
  });
}

/** 手动触发生成 */
export function templatesPut(req: Request): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    const r = generateFromTemplates();
    return ok(r);
  });
}
