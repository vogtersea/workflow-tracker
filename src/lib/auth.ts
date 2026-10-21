import { getDb } from './db-registry';
import { hashPassword, verifyPassword, randomToken } from './crypto';
import { IS_LOCAL_BUILD } from './runtime-mode';

/**
 * 认证与权限（同构）
 *
 * 本文件可在服务端与手机端浏览器里同时运行，**不得引入任何 node: 模块或 next/* 模块**。
 *
 * 取当前用户有两条路径：
 *   1. API 层：requireUserFrom(req) —— 从请求头 cookie 解析，两端行为一致
 *   2. 服务端组件：getCurrentUser() —— 依赖平台注册的解析器，
 *      服务端由 auth-server.ts 注册（读 next/headers 的 cookies），
 *      手机端由 auth-local.ts 注册（读本地存储的会话）
 *
 * 密码学实现已迁到 crypto.ts（纯 JS scrypt），与服务端历史哈希逐字节兼容。
 */

const COOKIE_NAME = 'wt_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
}

// 密码学函数在 auth 上保留同名转出口，历史 import 路径不用改
export { hashPassword, verifyPassword };

// ---------------- 当前用户解析器（平台相关，由各自入口注册） ----------------

type UserResolver = () => Promise<SessionUser | null>;

let _resolveCurrentUser: UserResolver | null = null;

export function setCurrentUserResolver(fn: UserResolver): void {
  _resolveCurrentUser = fn;
}

/**
 * 服务端组件 / 手机端组件通用的「取当前登录用户」。
 *
 * 未注册解析器时抛错而不是返回 null——否则会静默变成「所有人都未登录」，
 * 排查起来非常费劲。宁可让问题立刻暴露。
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (!_resolveCurrentUser) {
    throw new Error(
      '当前用户解析器未注册：服务端请 import @/lib/auth-server，手机端请先 initLocalAuth()'
    );
  }
  return _resolveCurrentUser();
}

// ---------------- 会话 ----------------

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = randomToken();
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  const expiresAt = expires.toISOString();
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
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

// ---------------- 从请求里取用户（API 层同构路径） ----------------

/** 极简 cookie 解析，不依赖 next/headers 或任何框架 */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const value = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/**
 * 从请求里取会话令牌。
 *
 * 两条来源：
 *   1. Cookie 头 —— 服务端形态的常规路径，httpOnly cookie 由浏览器自动带上
 *   2. X-WT-Session 头 —— 仅手机单机版使用
 *
 * 为什么单机版不能沿用 Cookie：浏览器的 Request 对象把 Cookie 列为禁用请求头，
 * 脚本设置会被静默丢弃（和 Set-Cookie 属同一类限制），只能走自定义头。
 * 这个分支只在手机版构建里生效，服务端形态不会接受该头，避免多出一条认证旁路。
 */
export function sessionTokenFromRequest(req: Request): string | null {
  const fromCookie = readCookie(req, COOKIE_NAME);
  if (fromCookie) return fromCookie;
  if (IS_LOCAL_BUILD) return req.headers.get('x-wt-session') || null;
  return null;
}

export function userFromRequest(req: Request): SessionUser | null {
  return userFromToken(sessionTokenFromRequest(req));
}

export function requireUserFrom(req: Request): SessionUser {
  const u = userFromRequest(req);
  if (!u) throw new UnauthorizedError();
  return u;
}

export function requireAdminFrom(req: Request): SessionUser {
  const u = requireUserFrom(req);
  if (u.role !== 'admin') throw new ForbiddenError('仅管理员可执行该操作');
  return u;
}

// ---------------- 兼容旧签名（服务端组件路径） ----------------

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

export const COOKIE_KEY = COOKIE_NAME;

// ---------------- 错误类型 ----------------

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
