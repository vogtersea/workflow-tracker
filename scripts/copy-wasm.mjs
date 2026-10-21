#!/usr/bin/env node
/**
 * 把 sqlite-wasm 的二进制拷到 public/，供浏览器端按 /sqlite3.wasm 直接加载。
 *
 * 为什么不提交进仓库：879KB 的二进制每个版本都会变，进 git 只会让仓库无谓膨胀。
 * 这里由 postinstall 自动复制，clone 后 npm install 就位。
 * 服务端（Docker 版）根本不会用到它，缺失也不影响启动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist', 'sqlite3.wasm');
const dstDir = path.join(root, 'public');
const dst = path.join(dstDir, 'sqlite3.wasm');

if (!fs.existsSync(src)) {
  console.log('[copy-wasm] 未找到 sqlite-wasm 包，跳过（仅手机端需要）');
  process.exit(0);
}

fs.mkdirSync(dstDir, { recursive: true });

const srcSize = fs.statSync(src).size;
if (fs.existsSync(dst) && fs.statSync(dst).size === srcSize) {
  console.log(`[copy-wasm] 已是最新（${(srcSize / 1024).toFixed(0)} KB）`);
  process.exit(0);
}

fs.copyFileSync(src, dst);
console.log(`[copy-wasm] 已复制 sqlite3.wasm（${(srcSize / 1024).toFixed(0)} KB）→ public/`);
