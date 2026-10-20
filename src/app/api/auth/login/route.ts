import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword, createSession, ensureAdminSeed, audit, COOKIE_KEY } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    ensureAdminSeed();

    const body = (await req.json()) as { username?: string; password?: string };
    const username = (body.username || '').trim();
    const password = body.password || '';

    if (!username || !password) {
      return NextResponse.json({ ok: false, error: '请输入用户名和密码' }, { status: 400 });
    }

    const row = getDb()
      .prepare(
        'SELECT id, username, display_name, password_hash, role, active FROM users WHERE username = ?'
      )
      .get(username) as
      | {
          id: number;
          username: string;
          display_name: string;
          password_hash: string;
          role: string;
          active: number;
        }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      return NextResponse.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });
    }
    if (!row.active) {
      return NextResponse.json({ ok: false, error: '该账号已被停用，请联系管理员' }, { status: 403 });
    }

    const { token, expiresAt } = createSession(row.id);
    audit(row.id, 'login', 'user', username);

    const res = NextResponse.json({
      ok: true,
      data: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role
      }
    });

    res.cookies.set({
      name: COOKIE_KEY,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.COOKIE_SECURE === '1',
      expires: new Date(expiresAt)
    });

    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : '登录失败';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
