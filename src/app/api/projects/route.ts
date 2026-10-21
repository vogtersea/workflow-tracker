// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { projectsGet, projectsPost, projectsDelete } from '@/lib/api/projects';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return projectsGet(req);
}

export async function POST(req: Request) {
  return projectsPost(req);
}

export async function DELETE(req: Request) {
  return projectsDelete(req);
}
