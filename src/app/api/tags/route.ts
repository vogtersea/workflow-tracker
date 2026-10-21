// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { tagsGet, tagsPost, tagsDelete } from '@/lib/api/tags';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return tagsGet(req);
}

export async function POST(req: Request) {
  return tagsPost(req);
}

export async function DELETE(req: Request) {
  return tagsDelete(req);
}
