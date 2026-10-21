#!/usr/bin/env node
/**
 * 确保每个 route.ts 都显式导入了服务端数据库实现。
 *
 * 为什么需要：Next 在 dev 下为不同入口创建独立的模块上下文，
 * instrumentation.ts 的 register() 并不保证先于 route 执行。
 * 只要某个 route 没 import db.ts，它拿到的就是未注册的 registry，
 * 运行时直接报「数据库尚未初始化」——页面全白，API 却一切正常，极难排查。
 * 所以统一在这里补一行副作用导入，由脚本保证不会漏。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', 'src/app/api/**/route.ts'], {
  cwd: ROOT,
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean);

const IMPORT_LINE = "import '@/lib/db';";
let added = 0;
let ok = 0;

for (const rel of files) {
  const file = path.join(ROOT, rel);
  let src = fs.readFileSync(file, 'utf8');

  // 已经直接用了 @/lib/db 的就不重复加（那个 import 本身就是副作用导入）
  if (/from '@\/lib\/db';/.test(src) || /import '@\/lib\/db';/.test(src)) {
    ok++;
    continue;
  }

  const lines = src.split('\n');
  const idx = lines.findIndex((l) => /^import\s/.test(l));
  if (idx < 0) {
    lines.unshift(IMPORT_LINE, '');
  } else {
    lines.splice(idx, 0, IMPORT_LINE);
  }
  // 补一句说明，避免后来者当成冗余 import 删掉
  lines.splice(0, 0, '// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）');

  fs.writeFileSync(file, lines.join('\n'));
  added++;
  console.log(`  + ${rel}`);
}

console.log(`\n新增 ${added} 个，已有 ${ok} 个，共 ${files.length} 个 route.ts`);
