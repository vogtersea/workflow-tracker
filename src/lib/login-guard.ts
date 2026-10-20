import { getDb } from './db';

/**
 * 登录失败节流
 *
 * 定位：提高暴力破解成本，不是绝对阻断。直连时 X-Forwarded-For 可伪造，
 * 若走反向代理，必须让代理「覆盖」而非「追加」该头，否则限流形同虚设。
 *
 * 规则：同一 用户名+IP 在 5 分钟内失败 5 次即锁定，返回 429 与 Retry-After。
 */

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}

export function isBlocked(username: string, ip: string): { blocked: boolean; retryAfter: number } {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c, MIN(at) AS first
         FROM login_attempts
        WHERE username = ? AND ip = ? AND at > ?`
    )
    .get(username.toLowerCase(), ip, cutoff) as { c: number; first: string | null };

  if (row.c < MAX_FAILURES || !row.first) return { blocked: false, retryAfter: 0 };

  const remain = WINDOW_MS - (Date.now() - new Date(row.first).getTime());
  return { blocked: true, retryAfter: Math.max(1, Math.ceil(remain / 1000)) };
}

export function recordFailure(username: string, ip: string): void {
  const db = getDb();
  db.prepare('INSERT INTO login_attempts (username, ip, at) VALUES (?, ?, ?)').run(
    username.toLowerCase(),
    ip,
    new Date().toISOString()
  );
  // 顺手清理过期记录，表不会无限增长
  db.prepare('DELETE FROM login_attempts WHERE at < ?').run(
    new Date(Date.now() - RETENTION_MS).toISOString()
  );
}

export function clearFailures(username: string, ip: string): void {
  getDb()
    .prepare('DELETE FROM login_attempts WHERE username = ? AND ip = ?')
    .run(username.toLowerCase(), ip);
}

/** 供状态检查用：当前是否处于锁定中（不消耗尝试次数） */
export function failureWindowInfo(): { windowMinutes: number; maxFailures: number } {
  return { windowMinutes: WINDOW_MS / 60000, maxFailures: MAX_FAILURES };
}
