/**
 * 手机单机版静态导出构建
 *
 * 用法：node scripts/build-local.mjs
 *
 * 产出：out-local/（纯静态站点，可直接交给 Capacitor 打 APK）
 *
 * 原理：
 *   静态导出有三条硬性约束——不允许 middleware、不允许 API 路由、
 *   不允许动态路由。前两者在本地档里本来就无用武之地（全部业务都在
 *   浏览器内完成），因此构建前把它们临时挪开，构建完立即还原：
 *     src/app/api/**            → .local-build-skip/api/**
 *     src/middleware.ts         → .local-build-skip/middleware.ts
 *     src/instrumentation.ts    → .local-build-skip/instrumentation.ts
 *   第三条已在代码层解决：详情页改为 /tasks/detail?id= 查询串路由。
 *
 * 注意：
 *   - out/ 是 next export 的固定输出目录，构建后整体改名成 out-local
 *   - 服务端版构建（npm run build）不受本脚本影响
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipDir = path.join(root, '.local-build-skip');
const distDir = '.next-local';
const outLocal = path.join(root, 'out-local');

const moved = [];

function moveAway(rel, destRel) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) return;
  const dest = path.join(skipDir, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  moved.push([dest, src]);
}

function restoreAll() {
  while (moved.length) {
    const [dest, src] = moved.pop();
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.renameSync(dest, src);
  }
  try {
    fs.rmSync(skipDir, { recursive: true, force: true });
  } catch {
    /* 还原失败时保留现场便于排查 */
  }
}

console.log('── 手机单机版静态导出构建 ──');

// 0. wasm 就位（浏览器端 SQLite 必需，入库被忽略所以每次都要确认）
const wasm = path.join(root, 'public', 'sqlite3.wasm');
if (!fs.existsSync(wasm)) {
  console.log('· 复制 sqlite3.wasm 到 public/');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'copy-wasm.mjs')], { stdio: 'inherit' });
}

// 1. 清掉上次导出的产物，避免混入旧文件
for (const d of [outLocal, path.join(root, distDir)]) {
  fs.rmSync(d, { recursive: true, force: true });
}

// 1.5 清掉其他 dist 目录里的生成类型：Next 每种 distDir 都会往 tsconfig
// include 里追加一条 <distDir>/types，服务端构建留下的类型引用了
// src/app/api（本地构建时已被挪走），不清理会导致类型检查报错
for (const name of fs.readdirSync(root)) {
  if (!name.startsWith('.next') || name === distDir) continue;
  const typesDir = path.join(root, name, 'types');
  if (fs.existsSync(typesDir)) fs.rmSync(typesDir, { recursive: true, force: true });
}

// 2. 挪走服务端专属文件
fs.rmSync(skipDir, { recursive: true, force: true });
moveAway('src/app/api', 'api');
moveAway('src/middleware.ts', 'middleware.ts');
moveAway('src/instrumentation.ts', 'instrumentation.ts');

try {
  // 3. 静态导出构建
  console.log('· next build（output: export）...');
  execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
    {
      stdio: 'inherit',
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        NEXT_PUBLIC_WT_LOCAL: '1',
        WT_LOCAL_EXPORT: '1',
        NEXT_DIST_DIR: distDir
      }
    }
  );

  // 4. 导出产物直接落在 .next-local（distDir 即导出目录，实测干净无中间产物）
  if (!fs.existsSync(path.join(root, distDir, 'index.html'))) {
    throw new Error('构建完成但导出产物缺失，导出可能失败');
  }
  fs.renameSync(path.join(root, distDir), outLocal);

  // 5. 自检关键文件
  const must = ['index.html', 'login/index.html', 'tasks/index.html', 'tasks/detail/index.html'];
  const missing = must.filter((f) => !fs.existsSync(path.join(outLocal, f)));
  if (missing.length) throw new Error('导出缺少关键文件：' + missing.join(', '));
  const wasmOut = path.join(outLocal, 'sqlite3.wasm');
  if (!fs.existsSync(wasmOut)) throw new Error('导出缺少 sqlite3.wasm');

  const sizeMB = (dir) => {
    let n = 0;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      n += f.isDirectory() ? sizeMB(p) : fs.statSync(p).size;
    }
    return n;
  };
  console.log(`✓ 导出完成：out-local/（约 ${(sizeMB(outLocal) / 1024 / 1024).toFixed(1)} MB）`);
} finally {
  restoreAll();
  console.log('· 服务端专属文件已还原');
}
