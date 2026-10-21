import { requireUserFrom, audit } from '@/lib/auth';
import { listTags, createTag, deleteTag } from '@/lib/tasks';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 标签接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 并把「从 cookie 取用户」改成从入参 req 取，从而能在浏览器里直接调用。
 */

export function tagsGet(req: Request): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    return ok(listTags());
  });
}

export function tagsPost(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const body = await readJson<{ name?: string; color?: string }>(req);
    const name = (body.name || '').trim();
    if (!name) return fail('标签名称不能为空', 400);
    if (name.length > 20) return fail('标签名称不超过 20 个字符', 400);

    const id = createTag(name, body.color || '#b91c1c');
    audit(user.id, 'tag.create', String(id), name);
    return ok({ id });
  });
}

export function tagsDelete(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return fail('缺少标签 ID', 400);

    deleteTag(id);
    audit(user.id, 'tag.delete', String(id));
    return ok(undefined);
  });
}
