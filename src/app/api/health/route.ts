// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import fs from 'node:fs';
import { dbPath } from '@/lib/db';
import { ensureAdminSeed } from '@/lib/auth-server';
import { startReminderLoop } from '@/lib/reminder-loop';
import { healthGet } from '@/lib/api/health';

export const dynamic = 'force-dynamic';

/** 健康检查 — 供 Docker healthcheck 使用 */
export async function GET() {
  // 首次启动自建管理员：原来挂在服务端 layout 上，layout 转客户端后挪到这里。
  // Docker healthcheck 每 30 秒打一次，服务起来后必然被执行，幂等。
  ensureAdminSeed();

  // 后台提醒循环的启动点：Docker healthcheck 每 30 秒打一次这里，
  // 桌面版启动时也会轮询，因此服务起来后必然被唤醒，不依赖有人打开页面。
  // startReminderLoop 内部有幂等标记，重复调用无副作用。
  startReminderLoop();

  return healthGet({
    dbPath: dbPath(),
    fileSize: (p) => {
      try {
        return fs.statSync(p).size;
      } catch {
        return 0;
      }
    },
    runtime: { node: process.version, uptime: process.uptime() }
  });
}
