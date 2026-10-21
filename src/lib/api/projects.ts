import { requireUserFrom, audit } from '@/lib/auth';
import { listProjects, createProject, deleteProject, getProject } from '@/lib/projects';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 项目列表接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

export function projectsGet(req: Request): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (id) {
      const p = getProject(Number(id));
      if (!p) return fail('项目不存在', 404);
      return ok(p);
    }
    const includeArchived = url.searchParams.get('all') === '1';
    return ok(listProjects({ includeArchived }));
  });
}

export function projectsPost(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const body = await readJson<{ name?: string; description?: string; color?: string }>(req);
    const name = (body.name || '').trim();
    if (!name) return fail('项目名称不能为空', 400);
    if (name.length > 40) return fail('项目名称不超过 40 个字符', 400);

    let id: number;
    try {
      id = createProject({ name, description: body.description || '', color: body.color || '#7f1d1d' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE|constraint/i.test(msg)) return fail('已存在同名项目', 400);
      throw e;
    }

    audit(user.id, 'project.create', String(id), name);
    return ok({ id });
  });
}

export function projectsDelete(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return fail('缺少项目 ID', 400);

    deleteProject(id);
    audit(user.id, 'project.delete', String(id));
    return ok(undefined);
  });
}
