// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import fs from 'node:fs';
import { dbPath, dataDir } from '@/lib/db';
import * as obsidian from '@/lib/obsidian';
import { settingsGet, settingsPost } from '@/lib/api/settings';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // 部署环境信息只有服务端能拿到，读好后注入同构处理函数
  let dbSize = 0;
  try {
    dbSize = fs.statSync(dbPath()).size;
  } catch {
    dbSize = 0;
  }

  return settingsGet(req, {
    dbPath: dbPath(),
    dataDir: dataDir(),
    dbSize,
    nodeVersion: process.version,
    obsidian: {
      vaultEnabled: obsidian.vaultEnabled,
      vaultDir: obsidian.vaultDir,
      vaultDirSource: obsidian.vaultDirSource,
      writebackSubdir: obsidian.writebackSubdir
    }
  });
}

export async function POST(req: Request) {
  return settingsPost(req);
}
