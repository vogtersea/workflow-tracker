import {
  requireUserFrom,
  requireAdminFrom,
  readCookie,
  audit,
  verifyPassword,
  hashPassword,
  COOKIE_KEY
} from '@/lib/auth';
import { getDb } from '@/lib/db-registry';
import { ok, fail, readJson } from './http';
import { guard } from './guard';

/**
 * 用户管理接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response，
 * 把「从 cookie 取用户」改成从入参 req 取、把 cookies() 改成 readCookie(req)，
 * 从而能在浏览器里直接调用。
 *
 * 注意 PATCH 里「修改自己的密码」必须排在 requireAdmin 之前判断，
 * 否则普通成员改不了自己的密码。
 */

interface UserPatchBody {
  action?: string;
  id?: number | string;
  password?: string;
  oldPassword?: unknown;
  display_name?: string;
  role?: string;
  active?: number | string;
}

export function usersGet(req: Request): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    const rows = getDb()
      .prepare(
        `SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id`
      )
      .all();
    return ok(rows);
  });
}

export function usersPost(req: Request): Promise<Response> {
  return guard(async () => {
    const admin = requireAdminFrom(req);
    const body = await readJson<{
      username?: string;
      display_name?: string;
      password?: string;
      role?: string;
    }>(req);

    const username = (body.username || '').trim();
    const display = (body.display_name || '').trim();
    const password = body.password || '';

    if (!username || !display) return fail('用户名和姓名必填', 400);
    if (password.length < 6) return fail('密码至少 6 位', 400);
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username))
      return fail('用户名 3-30 位，仅支持字母、数字、下划线、点、横线', 400);

    const db = getDb();
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return fail('用户名已存在', 409);

    const info = db
      .prepare(
        'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
      )
      .run(username, display, hashPassword(password), body.role === 'admin' ? 'admin' : 'member');

    audit(admin.id, 'user.create', String(info.lastInsertRowid), username);
    return ok({ id: info.lastInsertRowid });
  });
}

export function usersPatch(req: Request): Promise<Response> {
  return guard(async () => {
    const body = await readJson<UserPatchBody>(req);

    // 修改自己的密码：任何登录用户都可操作，不要求管理员
    if (body.action === 'changeOwnPassword') {
      const me = requireUserFrom(req);
      const pwd = body.password || '';
      if (pwd.length < 6) return fail('密码至少 6 位', 400);

      const db0 = getDb();
      const row = db0.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as
        | { password_hash: string }
        | undefined;
      if (!row) return fail('账号不存在', 404);

      // 已设置过密码的账号，改密需校验原密码，防止会话被劫持后直接改密
      if (body.oldPassword !== undefined && body.oldPassword !== null) {
        if (!verifyPassword(String(body.oldPassword), row.password_hash)) {
          return fail('原密码不正确', 400);
        }
      }

      db0.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pwd), me.id);
      // 保留当前会话，踢掉其他设备
      const currentToken = readCookie(req, COOKIE_KEY);
      if (currentToken) {
        db0.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(me.id, currentToken);
      } else {
        db0.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id);
      }
      audit(me.id, 'user.changeOwnPassword', String(me.id));
      return ok(undefined);
    }

    const admin = requireAdminFrom(req);
    const db = getDb();

    if (body.action === 'resetPassword') {
      const id = Number(body.id);
      const pwd = body.password || '';
      if (pwd.length < 6) return fail('密码至少 6 位', 400);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pwd), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(admin.id, 'user.resetPassword', String(id));
      return ok(undefined);
    }

    const id = Number(body.id);
    if (!id) return fail('缺少用户 ID', 400);

    const fields: string[] = [];
    const params: unknown[] = [];
    if (body.display_name !== undefined) {
      fields.push('display_name = ?');
      params.push(body.display_name);
    }
    if (body.role !== undefined) {
      if (!['admin', 'member'].includes(body.role)) return fail('角色不合法', 400);
      // 防止把最后一个管理员降级
      if (body.role === 'member') {
        const admins = db
          .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1")
          .get() as { c: number };
        const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as
          | { role: string }
          | undefined;
        if (admins.c <= 1 && target?.role === 'admin')
          return fail('系统需保留至少一名管理员，无法降级', 400);
      }
      fields.push('role = ?');
      params.push(body.role);
    }
    if (body.active !== undefined) {
      if (Number(body.active) === 0 && Number(id) === admin.id)
        return fail('不能停用当前登录账号', 400);
      fields.push('active = ?');
      params.push(Number(body.active) ? 1 : 0);
    }

    if (!fields.length) return fail('无可更新字段', 400);
    params.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    audit(admin.id, 'user.update', String(id));
    return ok(undefined);
  });
}

export function usersDelete(req: Request): Promise<Response> {
  return guard(async () => {
    const admin = requireAdminFrom(req);
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return fail('缺少用户 ID', 400);
    if (id === admin.id) return fail('不能删除当前登录账号', 400);

    const db = getDb();
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as
      | { role: string }
      | undefined;
    if (target?.role === 'admin') {
      const admins = db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1")
        .get() as { c: number };
      if (admins.c <= 1) return fail('系统需保留至少一名管理员', 400);
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(admin.id, 'user.delete', String(id));
    return ok(undefined);
  });
}
