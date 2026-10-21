// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { usersGet, usersPost, usersPatch, usersDelete } from '@/lib/api/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return usersGet(req);
}

export async function POST(req: Request) {
  return usersPost(req);
}

export async function PATCH(req: Request) {
  return usersPatch(req);
}

export async function DELETE(req: Request) {
  return usersDelete(req);
}
