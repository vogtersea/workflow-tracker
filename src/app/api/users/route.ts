import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  requireUser,
  requireAdmin,
  audit,
  verifyPassword,
  hashPassword,
  COOKIE_KEY,
  UnauthorizedError,
  ForbiddenError
} from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const rows = getDb()
      .prepare(
        `SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id`
      )
      .all();
    return NextResponse.json({ ok: true, data: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '查询失败' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();

    const username = (body.username || '').trim();
    const display = (body.display_name || '').trim();
    const password = body.password || '';

    if (!username || !display) 
      return NextResponse.json({ ok: false, error: '用户名和姓名必填' }, { status: 400 });
    if (password.length < 6)
      return NextResponse.json({ ok: false, error: '密码至少 6 位' }, { status: 400 });
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username))
      return NextResponse.json(
        { ok: false, error: '用户名 3-30 位，仅支持字母、数字、下划线、点、横线' },
        { status: 400 }
      );

    const db = getDb();
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return NextResponse.json({ ok: false, error: '用户名已存在' }, { status: 409 });

    const info = db
      .prepare(
        'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
      )
      .run(username, display, hashPassword(password), body.role === 'admin' ? 'admin' : 'member');

    audit(admin.id, 'user.create', String(info.lastInsertRowid), username);
    return NextResponse.json({ ok: true, data: { id: info.lastInsertRowid } });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    return NextResponse.json({ ok: false, error: '创建失败' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    // 修改自己的密码：任何登录用户都可操作，不要求管理员
    if (body.action === 'changeOwnPassword') {
      const me = await requireUser();
      const pwd = body.password || '';
      if (pwd.length < 6)
        return NextResponse.json({ ok: false, error: '密码至少 6 位' }, { status: 400 });

      const db0 = getDb();
      const row = db0.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as
        | { password_hash: string }
        | undefined;
      if (!row) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });

      // 已设置过密码的账号，改密需校验原密码，防止会话被劫持后直接改密
      if (body.oldPassword !== undefined && body.oldPassword !== null) {
        if (!verifyPassword(String(body.oldPassword), row.password_hash)) {
          return NextResponse.json({ ok: false, error: '原密码不正确' }, { status: 400 });
        }
      }

      db0.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pwd), me.id);
      // 保留当前会话，踢掉其他设备
      const jar = await cookies();
      const currentToken = jar.get(COOKIE_KEY)?.value;
      if (currentToken) {
        db0.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(me.id, currentToken);
      } else {
        db0.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id);
      }
      audit(me.id, 'user.changeOwnPassword', String(me.id));
      return NextResponse.json({ ok: true });
    }

    const admin = await requireAdmin();
    const db = getDb();

    if (body.action === 'resetPassword') {
      const id = Number(body.id);
      const pwd = body.password || '';
      if (pwd.length < 6)
        return NextResponse.json({ ok: false, error: '密码至少 6 位' }, { status: 400 });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pwd), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(admin.id, 'user.resetPassword', String(id));
      return NextResponse.json({ ok: true });
    }

    const id = Number(body.id);
    if (!id) return NextResponse.json({ ok: false, error: '缺少用户 ID' }, { status: 400 });

    const fields: string[] = [];
    const params: unknown[] = [];
    if (body.display_name !== undefined) {
      fields.push('display_name = ?');
      params.push(body.display_name);
    }
    if (body.role !== undefined) {
      if (!['admin', 'member'].includes(body.role))
        return NextResponse.json({ ok: false, error: '角色不合法' }, { status: 400 });
      // 防止把最后一个管理员降级
      if (body.role === 'member') {
        const admins = db
          .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1")
          .get() as { c: number };
        const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as
          | { role: string }
          | undefined;
        if (admins.c <= 1 && target?.role === 'admin')
          return NextResponse.json(
            { ok: false, error: '系统需保留至少一名管理员，无法降级' },
            { status: 400 }
          );
      }
      fields.push('role = ?');
      params.push(body.role);
    }
    if (body.active !== undefined) {
      if (Number(body.active) === 0 && Number(id) === admin.id)
        return NextResponse.json({ ok: false, error: '不能停用当前登录账号' }, { status: 400 });
      fields.push('active = ?');
      params.push(Number(body.active) ? 1 : 0);
    }

    if (!fields.length) return NextResponse.json({ ok: false, error: '无可更新字段' }, { status: 400 });
    params.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    audit(admin.id, 'user.update', String(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    return NextResponse.json({ ok: false, error: '更新失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) return NextResponse.json({ ok: false, error: '缺少用户 ID' }, { status: 400 });
    if (id === admin.id)
      return NextResponse.json({ ok: false, error: '不能删除当前登录账号' }, { status: 400 });

    const db = getDb();
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as
      | { role: string }
      | undefined;
    if (target?.role === 'admin') {
      const admins = db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1")
        .get() as { c: number };
      if (admins.c <= 1)
        return NextResponse.json({ ok: false, error: '系统需保留至少一名管理员' }, { status: 400 });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(admin.id, 'user.delete', String(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }
}
