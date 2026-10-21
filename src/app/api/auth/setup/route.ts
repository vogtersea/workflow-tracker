// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { authSetup } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/**
 * 首次初始化管理员
 *
 * 服务端正常情况下由 ensureAdminSeed 自动建号（口令写进数据目录的文本文件），
 * 这里保留入口是给「空库 + 无环境变量」的极端情况兜底，幂等，已有账号即拒绝。
 */
export async function POST(req: Request) {
  return authSetup(req);
}
