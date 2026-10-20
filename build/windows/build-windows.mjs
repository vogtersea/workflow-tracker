#!/usr/bin/env node
'use strict';

/**
 * Windows 原生版打包脚本
 *
 * 全程只在本机完成：不访问 Docker、不访问 NAS。
 * Node 运行时取本机已安装版本，构建过程不做任何下载，内网环境同样可用。
 * 产物是一个自包含目录 —— 内置 Node 运行时 + 应用代码 + 数据目录，
 * 双击启动即可运行，无需安装 Node、无需任何外部服务。
 *
 * 用法：
 *   node build/windows/build-windows.mjs
 *   node build/windows/build-windows.mjs --skip-build        复用已有 .next
 *   node build/windows/build-windows.mjs --app-from <dir>    复用别处的 standalone 产物
 *   node build/windows/build-windows.mjs --node-exe <path>   指定要内置的 node.exe
 *   node build/windows/build-windows.mjs --no-zip            不生成 zip
 *   node build/windows/build-windows.mjs --installer         顺带调用 Inno Setup 生成安装包
 *
 * 目录约定：
 *   build/windows/launch/     启动器与安装脚本（原样拷入产物）
 *   build/windows/installer.iss  Inno Setup 安装包配置
 *   outputs/win-dist/         产物输出目录（已在 .gitignore 内）
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const LAUNCH_SRC = path.join(SCRIPT_DIR, 'launch');
const OUT_ROOT = path.join(REPO_ROOT, 'outputs', 'win-dist');
const PKG_NAME = '工作流程跟踪工作台-win-x64';
const PKG_DIR = path.join(OUT_ROOT, PKG_NAME);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = '') => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

function log(msg) {
  process.stdout.write(msg + '\n');
}
function step(msg) {
  log('\n=== ' + msg + ' ===');
}
function die(msg) {
  log('\n[构建失败] ' + msg);
  process.exit(1);
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
}

/**
 * 目录用 robocopy（正确处理中文路径、隐藏文件、长路径），文件用 fs 复制。
 * 注意：robocopy 是把“源目录的内容”复制进目标目录，目标目录需先存在；
 * 不能用 Copy-Item -Recurse，它在目标目录已存在时会多套一层同名目录。
 */
function copyPath(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    const r = spawnSync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1'], {
      stdio: 'inherit'
    });
    if (r.status === null || r.status >= 8) die(`复制目录失败（robocopy ${r.status}）：${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function rmTree(dir) {
  if (!fs.existsSync(dir)) return;
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Remove-Item -LiteralPath '${dir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`
    ],
    { stdio: 'inherit' }
  );
  if (r.status !== 0 && fs.existsSync(dir)) die(`清理失败：${dir}`);
}

/* --------------------------- 1. 构建应用 --------------------------- */

function runNextBuild() {
  step('1. 构建应用（next build）');
  const nextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextBin)) die('未找到 node_modules/next，请先执行 npm install');

  const major = Number(process.versions.node.split('.')[0]);
  const args = ['--experimental-sqlite', nextBin, 'build'];
  if (major >= 24) args.shift(); // Node 24 的 node:sqlite 已无需该标志

  log(`  使用 Node ${process.versions.node}（${process.execPath}）`);
  const r = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }
  });
  if (r.status !== 0) die('next build 失败，请检查上方输出');
}

function checkStandalone(dir) {
  const must = ['server.js', 'node_modules', '.next'];
  for (const m of must) {
    if (!fs.existsSync(path.join(dir, m))) {
      die(`standalone 产物不完整，缺少 ${m}：${dir}\n提示：确认 next.config.mjs 里 output 为 'standalone'`);
    }
  }
}

/* --------------------------- 2. 组装产物 --------------------------- */

function resolveNodeExe() {
  const explicit = opt('--node-exe');
  if (explicit) {
    if (!fs.existsSync(explicit)) die(`指定的 node.exe 不存在：${explicit}`);
    return explicit;
  }
  if (process.platform === 'win32' && /node\.exe$/i.test(process.execPath)) {
    return process.execPath;
  }
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe')
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;

  die(
    [
      '未找到可内置的 node.exe。',
      '请用 --node-exe 指定，或先安装 Node 22/24 到默认位置。',
      '（脚本不自动下载，避免在无外网环境下卡住。）'
    ].join('\n')
  );
}

function nodeVersionOf(exe) {
  const r = spawnSync(exe, ['-v'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '(未知)';
}

function assemble(appFrom, nodeExe, pkg) {
  step('2. 组装产物目录');
  const standalone = appFrom || path.join(REPO_ROOT, '.next', 'standalone');
  const staticDir = appFrom
    ? path.join(path.dirname(appFrom), 'static')
    : path.join(REPO_ROOT, '.next', 'static');
  const publicDir = path.join(REPO_ROOT, 'public');

  checkStandalone(standalone);
  if (!fs.existsSync(staticDir)) die(`缺少静态资源目录：${staticDir}`);

  rmTree(PKG_DIR);
  const appDir = path.join(PKG_DIR, 'app');
  fs.mkdirSync(appDir, { recursive: true });

  log('  复制 standalone 应用…');
  // 逐项复制，避免多套一层目录
  for (const item of fs.readdirSync(standalone)) {
    copyPath(path.join(standalone, item), path.join(appDir, item));
  }

  log('  复制 .next/static…');
  copyPath(staticDir, path.join(appDir, '.next', 'static'));

  if (fs.existsSync(publicDir)) {
    log('  复制 public…');
    copyPath(publicDir, path.join(appDir, 'public'));
  }

  log('  复制启动器…');
  copyPath(LAUNCH_SRC, path.join(PKG_DIR, 'launch'));

  log('  内置 Node 运行时…');
  const runtimeDir = path.join(PKG_DIR, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(nodeExe, path.join(runtimeDir, 'node.exe'));
  log(`    来源：${nodeExe}（${nodeVersionOf(nodeExe)}）`);

  // 版本号写入 package.json，便于界面上识别
  const appPkgFile = path.join(appDir, 'package.json');
  if (fs.existsSync(appPkgFile)) {
    try {
      const ap = JSON.parse(fs.readFileSync(appPkgFile, 'utf8'));
      ap.version = pkg.version;
      fs.writeFileSync(appPkgFile, JSON.stringify(ap, null, 2));
    } catch {
      /* 保持原样 */
    }
  }
}

/* --------------------------- 3. 配置与说明 --------------------------- */

const CONFIG_TEMPLATE = {
  port: 13681,
  host: '127.0.0.1',
  openBrowser: true,
  dataDir: 'data',
  vaultDir: '',
  adminUsername: 'admin',
  adminDisplayName: '系统管理员',
  adminPassword: '',
  cookieSecure: false,
  extraEnv: {}
};

const GUIDANCE = `工作流程跟踪工作台 · Windows 原生版

一、启动
   双击「启动工作台.cmd」。
   首次启动会自动生成管理员密码，显示在窗口里，同时保存在
   data\\初始密码.txt。登录后请立即在「系统设置 → 修改密码」里改掉。

   窗口保持打开期间服务在运行；关闭窗口即停止。
   如需停止但找不到窗口，双击「停止工作台.cmd」。

二、数据在哪
   全部数据都在本目录的 data\\ 子目录，只有一个 SQLite 文件：
       data\\workflow.db
   备份 = 复制整个 data 目录；迁移 = 把 data 目录拷到新机器同位置。
   本程序不连接任何外部服务，也不上传任何数据。

三、修改端口
   编辑 config.json 的 port。
   默认 13681，只监听 127.0.0.1（仅本机可访问）。
   若想局域网内其他设备访问，把 host 改成 0.0.0.0，并在防火墙放行该端口。

四、接入大模型（可选）
   打开界面 →「系统设置 → 大模型接入」，填 Base URL / API Key / 模型名。
   兼容 OpenAI 协议的服务都可以，本机或局域网内的网关同样可用。
   不配置也能正常使用工作管理功能，只是不能自动生成总结报告。

五、接入 Obsidian（可选）
   「系统设置 → Obsidian 知识库」里填本机知识库目录，例如：
       D:\\Users\\你\\Documents\\Obsidian\\你的知识库
   程序只做单向写回，不会修改已有笔记。

六、目录结构
   app\\       应用本体（Next standalone，含依赖）
   runtime\\   内置 Node 运行时（无需另装 Node）
   launch\\    启动器与安装脚本
   data\\      数据库与运行记录
   config.json 配置文件

七、卸载
   便携版：直接删除整个目录。
   安装版：从开始菜单或「设置 → 应用」里卸载，卸载程序不会删除 data 目录，
   需要清空数据请手动删除。
`;

function writeConfigAndDocs(pkg) {
  step('3. 写入配置与说明');

  const cfgFile = path.join(PKG_DIR, 'config.json');
  if (!fs.existsSync(cfgFile)) {
    fs.writeFileSync(cfgFile, JSON.stringify(CONFIG_TEMPLATE, null, 2) + '\r\n', 'utf8');
    log('  config.json 已生成（默认端口 13681）');
  } else {
    log('  config.json 已存在，保留原配置');
  }

  fs.writeFileSync(path.join(PKG_DIR, '使用说明.txt'), GUIDANCE.replace(/\n/g, '\r\n'), 'utf8');
  log('  使用说明.txt 已生成');

  const dataDir = path.join(PKG_DIR, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  log('  data 目录已就绪');
}

/* --------------------------- 4. 压缩 --------------------------- */

function makeZip(pkg) {
  step('4. 生成 zip');
  const zip = path.join(OUT_ROOT, `${PKG_NAME}-${pkg.version}.zip`);
  if (fs.existsSync(zip)) fs.rmSync(zip, { force: true });
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath '${PKG_DIR.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`
    ],
    { stdio: 'inherit' }
  );
  if (r.status !== 0) die('压缩失败');
  const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
  log(`  ${zip}（${mb} MB）`);
  return zip;
}

/* --------------------------- 5. 安装包 --------------------------- */

function findIscc() {
  // 1) PATH
  const where = spawnSync('where', ['iscc'], { encoding: 'utf8' });
  if (where.status === 0 && where.stdout.trim()) return where.stdout.trim().split(/\r?\n/)[0];

  // 2) 常见安装位置（注意可能装在非系统盘）
  const roots = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : ''
  ].filter(Boolean);
  for (const r of roots) {
    for (const v of ['Inno Setup 7', 'Inno Setup 6']) {
      const p = path.join(r, v, 'ISCC.exe');
      if (fs.existsSync(p)) return p;
    }
  }

  // 3) 注册表：安装位置可能被改到别的盘，按显示名反查
  const ps = [
    "$p=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
    'Get-ItemProperty $p -ErrorAction SilentlyContinue |',
    "Where-Object { $_.DisplayName -like '*Inno Setup*' -and $_.InstallLocation } |",
    "ForEach-Object { Join-Path $_.InstallLocation 'ISCC.exe' } |",
    'Where-Object { Test-Path $_ } | Select-Object -First 1'
  ].join(' ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8'
  });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();

  return '';
}

function makeInstaller(pkg) {
  step('5. 生成安装包（Inno Setup）');
  const iscc = findIscc();
  if (!iscc) {
    log('  未检测到 ISCC.exe，跳过。');
    log('  如需生成 Setup.exe：安装 Inno Setup 6 后重跑本脚本并加 --installer。');
    log('  也可直接分发 zip，解压后双击「启动工作台.cmd」即可用。');
    return null;
  }
  const out = path.join(OUT_ROOT, 'installer-out');
  fs.mkdirSync(out, { recursive: true });
  const r = spawnSync(
    iscc,
    [
      `/DAppVersion=${pkg.version}`,
      `/DSourceDir=${PKG_DIR}`,
      `/DOutputDir=${out}`,
      path.join(SCRIPT_DIR, 'installer.iss')
    ],
    { stdio: 'inherit' }
  );
  if (r.status !== 0) {
    log('  安装包生成失败，zip 仍可用。');
    return null;
  }
  const setup = path.join(out, `WorkflowTracker-Setup-${pkg.version}.exe`);
  log(`  ${fs.existsSync(setup) ? setup : out}`);
  return setup;
}

/* ------------------------------ 主流程 ------------------------------ */

function main() {
  if (process.platform !== 'win32') {
    die('本脚本只能在 Windows 上运行（产出的也是 Windows 程序）。');
  }
  const pkg = readPkg();
  log(`工作流程跟踪工作台 · Windows 打包 v${pkg.version}`);
  log(`仓库根目录：${REPO_ROOT}`);

  const appFrom = opt('--app-from');
  if (!flag('--skip-build') && !appFrom) runNextBuild();
  else log('\n  跳过构建，复用已有产物');

  const nodeExe = resolveNodeExe();
  assemble(appFrom, nodeExe, pkg);
  writeConfigAndDocs(pkg);

  let zip = null;
  if (!flag('--no-zip')) zip = makeZip(pkg);
  const setup = flag('--installer') ? makeInstaller(pkg) : null;

  step('完成');
  log(`  产物目录：${PKG_DIR}`);
  if (zip) log(`  压缩包：  ${zip}`);
  if (setup) log(`  安装包：  ${setup}`);
  log('\n  下一步：双击产物目录里的「启动工作台.cmd」即可运行。');
}

main();
