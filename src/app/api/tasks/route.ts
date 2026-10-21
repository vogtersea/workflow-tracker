// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { tasksGet, tasksPost } from '@/lib/api/tasks';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return tasksGet(req);
}

export async function POST(req: Request) {
  return tasksPost(req);
}
