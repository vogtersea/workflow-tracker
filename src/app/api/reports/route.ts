// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { reportsGet, reportsPost } from '@/lib/api/reports';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  return reportsGet(req);
}

export async function POST(req: Request) {
  return reportsPost(req);
}
