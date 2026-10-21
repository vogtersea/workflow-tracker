#!/usr/bin/env node
/**
 * 把页面里的 fetch('/api/...') 批量换成 api('/api/...')
 *
 * 服务端形态下 api() 就是 fetch 的直通；手机单机形态下 api() 转本地 SQLite。
 * 页面代码因此不用关心自己跑在哪种形态里。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

const files = execFileSync('git', ['grep', '-l', "fetch('/api", '--', 'src/'], {
  cwd: ROOT,
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)
  .concat(
    execFileSync('git', ['grep', '-l', 'fetch(`/api', '--', 'src/'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
  );

const uniq = [...new Set(files)];
let changed = 0;

for (const rel of uniq) {
  const file = path.join(ROOT, rel);
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  src = src.replaceAll("fetch('/api", "api('/api");
  src = src.replaceAll('fetch(`/api', 'api(`/api');

  if (src === before) continue;

  // 补 import：放在最后一个 import 之后，避免打乱原有顺序
  if (!src.includes("from '@/lib/api-client'")) {
    const lines = src.split('\n');
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s/.test(lines[i])) lastImport = i;
    }
    const insertAt = lastImport >= 0 ? lastImport + 1 : 0;
    const stmt = "import { api } from '@/lib/api-client';";
    if (lastImport >= 0) lines.splice(insertAt, 0, stmt);
    else {
      // 没有 import 的话放在 'use client' 之后
      const idx = lines.findIndex((l) => l.includes("'use client'"));
      lines.splice(idx + 1, 0, '', stmt);
    }
    src = lines.join('\n');
  }

  fs.writeFileSync(file, src);
  changed++;
  const count = (before.match(/fetch\(/g) || []).length;
  console.log(`  ✓ ${rel}（${count} 处）`);
}

console.log(`\n共处理 ${changed} 个文件`);
