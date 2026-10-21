import { requireUserFrom, audit } from '@/lib/auth';
import { updateProject, getProject, deleteProject } from '@/lib/projects';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 单个项目接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

export function projectDetailPatch(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const pid = Number(id);
    if (!pid) return fail('缺少项目 ID', 400);

    const body = await readJson<{
      name?: unknown;
      description?: unknown;
      color?: unknown;
      status?: unknown;
    }>(req);
    const patch: Partial<{
      name: string;
      description: string;
      color: string;
      status: 'active' | 'archived';
    }> = {};
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (!n) return fail('项目名称不能为空', 400);
      patch.name = n;
    }
    if (typeof body.description === 'string') patch.description = body.description;
    if (typeof body.color === 'string') patch.color = body.color;
    if (body.status === 'active' || body.status === 'archived') patch.status = body.status;

    try {
      updateProject(pid, patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE|constraint/i.test(msg)) return fail('已存在同名项目', 400);
      throw e;
    }

    audit(user.id, 'project.update', String(pid), String(patch.name ?? ''));
    return ok(getProject(pid));
  });
}

export function projectDetailDelete(req: Request, id: string): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const pid = Number(id);
    if (!pid) return fail('缺少项目 ID', 400);

    // 直接走库删除；工作本身不删，仅解除项目归属（ON DELETE SET NULL）
    deleteProject(pid);

    audit(user.id, 'project.delete', String(pid));
    return ok(undefined);
  });
}
