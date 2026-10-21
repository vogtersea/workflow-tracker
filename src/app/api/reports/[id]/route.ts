// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { reportGet, reportPatch, reportDelete } from '@/lib/api/report-detail';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return reportGet(req, id);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return reportPatch(req, id);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return reportDelete(req, id);
}
