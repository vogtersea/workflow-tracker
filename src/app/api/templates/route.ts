// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import {
  templatesGet,
  templatesPost,
  templatesPatch,
  templatesDelete,
  templatesPut
} from '@/lib/api/templates';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return templatesGet(req);
}

export async function POST(req: Request) {
  return templatesPost(req);
}

export async function PATCH(req: Request) {
  return templatesPatch(req);
}

export async function DELETE(req: Request) {
  return templatesDelete(req);
}

export async function PUT(req: Request) {
  return templatesPut(req);
}
