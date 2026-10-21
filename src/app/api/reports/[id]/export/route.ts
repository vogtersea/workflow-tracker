// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import * as obsidian from '@/lib/obsidian';
import { reportExportGet } from '@/lib/api/report-export';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  // Obsidian 写回依赖 node:fs，由服务端注入真实实现
  return reportExportGet(req, id, {
    vaultEnabled: obsidian.vaultEnabled,
    writeReportToVault: obsidian.writeReportToVault
  });
}
