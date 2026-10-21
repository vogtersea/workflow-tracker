// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { authMe } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return authMe(req);
}
