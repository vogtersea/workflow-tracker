import { getDb } from '@/lib/db-registry';
import {
  verifyPassword,
  createSession,
  destroySession,
  hashPassword,
  audit,
  userFromRequest,
  sessionTokenFromRequest,
  COOKIE_KEY
} from '@/lib/auth';
import { clientIp, isBlocked, recordFailure, clearFailures } from '@/lib/login-guard';
import { IS_LOCAL_BUILD } from '@/lib/runtime-mode';
import { ok, fail, readJson, buildCookie, clearCookie } from './http';
import { guard } from './guard';

/**
 * 认证相关接口（同构）
 *
 * 服务端 route.ts 与手机端本地路由都调用这里，行为完全一致。
 * 会话写入靠标准 Set-Cookie 头：服务端浏览器直接生效，
 * 手机端由 api-client 截获后存进本地存储，再在后续请求里塞回 cookie 头。
 */

/**
 * 等时校验用的假哈希：用户不存在时也跑一次 scrypt，
 * 避免「响应快 = 账号不存在」的时序侧信道。
 * 惰性计算，避免手机端首次加载白付 38ms。
 */
let _dummyHash: string | null = null;
function dummyHash(): string {
  if (!_dummyHash) _dummyHash = hashPassword('__nonexistent_user_placeholder__');
  return _dummyHash;
}

function cookieSecure(): boolean {
  return typeof process !== 'undefined' && process.env?.COOKIE_SECURE === '1';
}

/**
 * 本地模式下把会话令牌额外放进自定义头。
 *
 * 原因：浏览器的 Response 对象不允许脚本写 Set-Cookie（属禁用响应头，写了也被静默丢弃），
 * 合成的 Response 上 getSetCookie() 永远是空数组。单机版没有真实 HTTP 响应，
 * 只能靠自定义头把令牌交给 api-router 存进本地存储。
 *
 * 只在手机版构建时附加，服务端形态仍走 httpOnly cookie，不把令牌暴露给页面脚本。
 */
function attachSession(res: Response, token: string): Response {
  if (IS_LOCAL_BUILD) res.headers.set('X-WT-Session', token);
  return res;
}

interface LoginRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  active: number;
}

export function authLogin(req: Request): Promise<Response> {
  return guard(async () => {
    const body = await readJson<{ username?: string; password?: string }>(req);
    const username = (body.username || '').trim();
    const password = body.password || '';

    if (!username || !password) return fail('请输入用户名和密码', 400);

    const ip = clientIp(req);
    const key = username.toLowerCase();

    const gate = isBlocked(key, ip);
    if (gate.blocked) {
      return fail(`尝试过于频繁，请 ${gate.retryAfter} 秒后再试`, 429, {
        retryAfter: gate.retryAfter
      });
    }

    const row = getDb()
      .prepare(
        'SELECT id, username, display_name, password_hash, role, active FROM users WHERE username = ?'
      )
      .get(username) as LoginRow | undefined;

    const matched = verifyPassword(password, row ? row.password_hash : dummyHash());

    if (!row || !matched) {
      recordFailure(key, ip);
      return fail('用户名或密码错误', 401);
    }
    if (!row.active) return fail('该账号已被停用，请联系管理员', 403);

    clearFailures(key, ip);

    const { token, expiresAt } = createSession(row.id);
    audit(row.id, 'login', 'user', username);

    const res = ok({
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      role: row.role
    });
    res.headers.append(
      'Set-Cookie',
      buildCookie(COOKIE_KEY, token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        secure: cookieSecure(),
        expires: new Date(expiresAt).toUTCString()
      })
    );
    return attachSession(res, token);
  });
}

export function authLogout(req: Request): Promise<Response> {
  return guard(async () => {
    const token = sessionTokenFromRequest(req);
    if (token) destroySession(token);
    const res = ok({ loggedOut: true });
    res.headers.append(
      'Set-Cookie',
      clearCookie(COOKIE_KEY, { httpOnly: true, sameSite: 'Lax', path: '/' })
    );
    return attachSession(res, '');
  });
}

export function authMe(req: Request): Promise<Response> {
  return guard(async () => {
    const user = userFromRequest(req);
    if (!user) return fail('未登录或登录已过期', 401);
    return ok(user);
  });
}

/**
 * 首次初始化管理员
 *
 * 手机单机版没有环境变量可注入初始口令，也不能像服务端那样把随机口令写到文件里
 * （浏览器写不了文件系统），所以由用户在首次使用时自己设定账号口令。
 * 幂等：库里已有任何账号就拒绝，避免被当成「重置密码」的后门。
 */
export function authSetup(req: Request): Promise<Response> {
  return guard(async () => {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    if (count > 0) return fail('系统已完成初始化，请直接登录', 400);

    const body = await readJson<{ username?: string; password?: string; display_name?: string }>(
      req
    );
    const username = (body.username || '').trim();
    const password = body.password || '';
    const display = (body.display_name || '').trim() || '本机用户';

    if (username.length < 2) return fail('用户名至少 2 个字符', 400);
    if (password.length < 6) return fail('密码至少 6 位', 400);

    const info = db
      .prepare(
        'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
      )
      .run(username, display, hashPassword(password), 'admin');
    const userId = Number(info.lastInsertRowid);

    const { token, expiresAt } = createSession(userId);
    audit(userId, 'user.setup', String(userId), username);

    const res = ok({ id: userId, username, display_name: display, role: 'admin' });
    res.headers.append(
      'Set-Cookie',
      buildCookie(COOKIE_KEY, token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        secure: cookieSecure(),
        expires: new Date(expiresAt).toUTCString()
      })
    );
    return attachSession(res, token);
  });
}
