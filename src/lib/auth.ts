import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getDb } from './db';
import type { NextRequest } from 'next/server';

/**
 * 认证与权限
 * - 密码使用 scrypt 加盐哈希
 * - 会话 token 存 cookie（httpOnly），服务端 sessions 表校验
 * - 角色：admin（全部权限）、member（仅本人工作）
 */

const COOKIE_NAME = 'wt_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  const expiresAt = expires.toISOString();
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token: string) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function sessionCookieOptions(expiresAt: string) {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: false,
    expires: new Date(expiresAt)
  };
}

/** 服务端组件/路由中取当前用户 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  return userFromToken(token);
}

/** 中间件/路由处理器取用户 */
export function userFromRequest(req: NextRequest): SessionUser | null {
  return userFromToken(req.cookies.get(COOKIE_NAME)?.value);
}

export function userFromToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.active = 1`
    )
    .get(token) as (SessionUser & { expires_at: string }) | undefined;
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}

export const COOKIE_KEY = COOKIE_NAME;

/** 未登录时抛出，由 API 包装器转换为 401 */
export class UnauthorizedError extends Error {
  constructor() {
    super('未登录或登录已过期');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(msg = '无权限执行该操作') {
    super(msg);
    this.name = 'ForbiddenError';
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new UnauthorizedError();
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'admin') throw new ForbiddenError('仅管理员可执行该操作');
  return u;
}

/** 首次启动自动创建管理员 */
export function ensureAdminSeed() {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return { created: false };

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123456';
  const display = process.env.ADMIN_DISPLAY_NAME || '系统管理员';

  const info = db
    .prepare(
      'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
    )
    .run(username, display, hashPassword(password), 'admin');

  return { created: true, username, password, id: Number(info.lastInsertRowid) };
}

/** 审计日志 */
export function audit(userId: number | null, action: string, target?: string, detail?: string) {
  try {
    getDb()
      .prepare('INSERT INTO audit_log (user_id, action, target, detail) VALUES (?, ?, ?, ?)')
      .run(userId, action, target ?? null, detail ?? null);
  } catch {
    /* 审计失败不阻断主流程 */
  }
}
