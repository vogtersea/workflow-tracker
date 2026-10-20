import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  verifyPassword,
  createSession,
  ensureAdminSeed,
  audit,
  hashPassword,
  COOKIE_KEY
} from '@/lib/auth';
import { clientIp, isBlocked, recordFailure, clearFailures } from '@/lib/login-guard';
import { startReminderLoop } from '@/lib/reminder-loop';

export const dynamic = 'force-dynamic';

/**
 * 等时校验用的假哈希：用户不存在时也跑一次 scrypt，
 * 避免「响应快 = 账号不存在」的时序侧信道。
 */
const DUMMY_HASH = hashPassword('__nonexistent_user_placeholder__');

export async function POST(req: Request) {
  try {
    ensureAdminSeed();
    // 兜底启动后台提醒循环（幂等）：即使没人轮询健康检查，登录一次也能把它唤醒
    startReminderLoop();

    const body = (await req.json()) as { username?: string; password?: string };
    const username = (body.username || '').trim();
    const password = body.password || '';

    if (!username || !password) {
      return NextResponse.json({ ok: false, error: '请输入用户名和密码' }, { status: 400 });
    }

    const ip = clientIp(req);
    const key = username.toLowerCase();

    const gate = isBlocked(key, ip);
    if (gate.blocked) {
      return NextResponse.json(
        { ok: false, error: `尝试过于频繁，请 ${gate.retryAfter} 秒后再试` },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } }
      );
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

    const matched = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);

    if (!row || !matched) {
      recordFailure(key, ip);
      return NextResponse.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });
    }
    if (!row.active) {
      return NextResponse.json({ ok: false, error: '该账号已被停用，请联系管理员' }, { status: 403 });
    }

    clearFailures(key, ip);

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
