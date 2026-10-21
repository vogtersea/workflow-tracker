// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import * as obsidian from '@/lib/obsidian';
import { obsidianGet } from '@/lib/api/obsidian';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // 文件系统访问在服务端专属的 obsidian 库里，注入给同构处理函数
  return obsidianGet(req, obsidian);
}
