import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';

// 副作用导入：向同构层注册 node:sqlite 实现。业务模块随后即可正常取库。
import { getDb, dataDir } from './db';
import { setCurrentUserResolver, userFromToken, COOKIE_KEY } from './auth';
import type { SessionUser } from './auth';
import { hashPassword, randomBytes } from './crypto';

/**
 * 服务端专属的认证部分
 *
 * 与 auth.ts 的分工：
 *   auth.ts        —— 同构，跑在服务端和手机端浏览器里
 *   auth-server.ts —— 只有服务端能跑（next/headers、node:fs）
 *
 * 任何服务端组件（layout / page）想用 getCurrentUser()，必须 import 本文件一次，
 * 否则解析器没注册，auth.ts 会直接抛错。
 */

// 注册「从 cookie 取当前用户」的解析器，供服务端组件使用
setCurrentUserResolver(async () => {
  const jar = await cookies();
  return userFromToken(jar.get(COOKIE_KEY)?.value);
});

export { getCurrentUser, requireUser, requireAdmin } from './auth';
export type { SessionUser };

/**
 * 首次启动自动创建管理员。
 *
 * 未显式配置 ADMIN_PASSWORD 时生成随机口令并写入数据目录下的文本文件——
 * 不落日志、不进返回值，杜绝默认口令兜底。
 */
export function ensureAdminSeed(): { created: boolean; username?: string } {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return { created: false };

  const username = process.env.ADMIN_USERNAME || 'admin';
  const fromEnv = process.env.ADMIN_PASSWORD;
  const password = fromEnv || Buffer.from(randomBytes(9)).toString('base64url');
  const display = process.env.ADMIN_DISPLAY_NAME || '系统管理员';

  db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(username, display, hashPassword(password), 'admin');

  if (!fromEnv) {
    const file = path.join(dataDir(), 'initial-password.txt');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        [
          '工作流程跟踪工作台 —— 首次启动生成的登录信息',
          '',
          `username: ${username}`,
          `password: ${password}`,
          '',
          '登录后请立即在「系统设置 → 修改密码」中修改，然后删除本文件。',
          `created_at: ${new Date().toISOString()}`
        ].join('\n'),
        { mode: 0o600 }
      );
      console.warn(`[init] 未设置 ADMIN_PASSWORD，已生成随机口令：${file}`);
    } catch (e) {
      console.warn('[init] 随机口令落盘失败，请立即用下面的口令登录并修改：', password, e);
    }
  }

  return { created: true, username };
}
