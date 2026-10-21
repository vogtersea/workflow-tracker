// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { ensureAdminSeed } from '@/lib/auth-server';
import { startReminderLoop } from '@/lib/reminder-loop';
import { authLogin } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/**
 * 服务端专属的启动动作放在这里，业务逻辑在 lib/api/auth.ts。
 * 手机端不经过这个文件，因此不会误跑种子账号与后台循环。
 */
export async function POST(req: Request) {
  ensureAdminSeed();
  // 兜底启动后台提醒循环（幂等）：即使没人轮询健康检查，登录一次也能把它唤醒
  startReminderLoop();
  return authLogin(req);
}
