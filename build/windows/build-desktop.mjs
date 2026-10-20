#!/usr/bin/env node
'use strict';

/**
 * 桌面版（Electron）打包脚本
 *
 * 产出真正的桌面程序：独立窗口、自己的图标与任务栏项，不经过浏览器。
 * 与服务端版共用同一份 Next standalone 产物，界面与功能完全一致。
 *
 * 用法：
 *   node build/windows/build-desktop.mjs
 *   node build/windows/build-desktop.mjs --app-from <standalone目录>
 *   node build/windows/build-desktop.mjs --no-installer
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = '') => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DESKTOP_SRC = path.resolve(SCRIPT_DIR, '..', 'desktop');
const OUT_ROOT = path.join(REPO_ROOT, 'outputs', 'win-dist');
const BUILD_DIR = path.join(OUT_ROOT, 'desktop-build');
const APPDATA_DIR = path.join(BUILD_DIR, 'appdata');
const PKG_OUT = opt('--out-dir') ? path.resolve(opt('--out-dir')) : path.join(OUT_ROOT, 'desktop');
const INSTALLER_OUT = path.join(OUT_ROOT, 'installer-out');

const log = (m) => process.stdout.write(m + '\n');
const step = (m) => log('\n=== ' + m + ' ===');
function die(m) {
  log('\n[打包失败] ' + m);
  process.exit(1);
}

function copyPath(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    const r = spawnSync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1'], {
      stdio: 'inherit'
    });
    if (r.status === null || r.status >= 8) die(`复制失败（robocopy ${r.status}）：${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function rmTree(dir) {
  if (!fs.existsSync(dir)) return;
  spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath '${dir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`],
    { stdio: 'inherit' }
  );
}

function findIscc() {
  const where = spawnSync('where', ['iscc'], { encoding: 'utf8' });
  if (where.status === 0 && where.stdout.trim()) return where.stdout.trim().split(/\r?\n/)[0];

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

  const ps = [
    "$p=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
    'Get-ItemProperty $p -ErrorAction SilentlyContinue |',
    "Where-Object { $_.DisplayName -like '*Inno Setup*' -and $_.InstallLocation } |",
    "ForEach-Object { Join-Path $_.InstallLocation 'ISCC.exe' } |",
    'Where-Object { Test-Path $_ } | Select-Object -First 1'
  ].join(' ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return '';
}

async function main() {
  if (process.platform !== 'win32') die('本脚本只能在 Windows 上运行。');

  // Electron 依赖刻意不放进主 package.json，否则 Docker 构建会连带下载 Electron
  let packager;
  try {
    ({ packager } = await import('@electron/packager'));
  } catch {
    die(
      [
        '缺少桌面版打包依赖。先在本机执行一次：',
        '',
        '  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/',
        '  npm i -D electron @electron/packager',
        '',
        '（这两个仅用于打包桌面版，已刻意不写入 package.json，以免影响 Docker 构建。）'
      ].join('\n')
    );
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

  step('1. 组装应用资源');
  const standalone = opt('--app-from') || path.join(REPO_ROOT, '.next', 'standalone');
  const staticDir = path.join(path.dirname(standalone), 'static');
  for (const need of ['server.js', 'node_modules', '.next']) {
    if (!fs.existsSync(path.join(standalone, need))) die(`standalone 不完整，缺少 ${need}：${standalone}`);
  }
  if (!fs.existsSync(staticDir)) die(`缺少静态资源：${staticDir}`);

  rmTree(APPDATA_DIR);
  fs.mkdirSync(APPDATA_DIR, { recursive: true });
  for (const item of fs.readdirSync(standalone)) {
    copyPath(path.join(standalone, item), path.join(APPDATA_DIR, item));
  }
  copyPath(staticDir, path.join(APPDATA_DIR, '.next', 'static'));
  const pub = path.join(REPO_ROOT, 'public');
  if (fs.existsSync(pub)) copyPath(pub, path.join(APPDATA_DIR, 'public'));
  log(`  应用资源：${APPDATA_DIR}`);

  step('2. 打包 Electron 应用');

  // Electron 刻意不写进 package.json（否则 Docker 的 npm ci 会连带下载），
  // 所以这里显式告诉 packager 用本机 node_modules 里的版本。
  let electronVersion = '44.9.1';
  try {
    electronVersion = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')
    ).version;
  } catch {
    log('  未读到 node_modules/electron 版本，使用默认值');
  }
  log(`  Electron 版本：${electronVersion}`);

  rmTree(PKG_OUT);
  const built = await packager({
    dir: DESKTOP_SRC,
    name: 'WorkflowTracker',
    platform: 'win32',
    arch: 'x64',
    out: PKG_OUT,
    overwrite: true,
    appVersion: pkg.version,
    electronVersion,
    icon: path.join(DESKTOP_SRC, 'icon.ico'),
    extraResource: [APPDATA_DIR],
    prune: true,
    asar: true,
    // 默认会去 GitHub Release 取 Electron，国内网络常失败；
    // 统一走 npmmirror 镜像，命中本地缓存时不会产生实际下载。
    download: {
      mirrorOptions: {
        mirror: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
        customDir: process.env.ELECTRON_CUSTOM_DIR || '{{ version }}'
      }
    },
    win32metadata: {
      CompanyName: '本地部署',
      FileDescription: '工作流程跟踪工作台',
      ProductName: '工作流程跟踪工作台',
      InternalName: 'WorkflowTracker',
      OriginalFilename: 'WorkflowTracker.exe',
      'requested-execution-level': 'asInvoker'
    },
    ignore: [/^\/(\.git|\.vscode|node_modules\/\.cache)/]
  });
  const appDir = built[0];
  if (!appDir) die('打包未产出目录');
  log(`  产物：${appDir}`);

  // 随包附一份说明，安装后开始菜单里能直接打开
  const guide = [
    '工作流程跟踪工作台 · 桌面版',
    '',
    '一、启动',
    '   双击「WorkflowTracker.exe」，或从开始菜单/桌面打开「工作流程跟踪工作台」。',
    '   程序是独立窗口，不在浏览器中运行。',
    '',
    '二、数据在哪',
    `   ${path.join(process.env.APPDATA || '%APPDATA%', '工作流程跟踪工作台', 'data')}`,
    '   备份 = 复制该 data 目录；迁移 = 拷到新机器同位置。',
    '   卸载程序不会删除该目录。',
    '',
    '三、菜单',
    '   文件 → 打开数据目录 / 打开备份目录 / 退出',
    '   视图 → 重新加载（F5）/ 缩放 / 全屏（F11）',
    '',
    '四、大模型接入（可选）',
    '   界面内「系统设置 → 大模型接入」，填 Base URL / API Key / 模型名，',
    '   兼容 OpenAI 协议的服务均可。',
    '',
    '五、卸载',
    '   设置 → 应用 → 工作流程跟踪工作台 → 卸载。'
  ].join('\r\n');
  fs.writeFileSync(path.join(appDir, '使用说明.txt'), guide, 'utf8');
  log('  已写入 使用说明.txt');

  step('3. 生成安装包');
  if (flag('--no-installer')) {
    log('  已跳过');
  } else {
    const iscc = findIscc();
    if (!iscc) {
      log('  未找到 ISCC.exe，跳过安装包。');
      log('  安装 Inno Setup 6 后重跑：winget install -e --id JRSoftware.InnoSetup');
    } else {
      fs.mkdirSync(INSTALLER_OUT, { recursive: true });
      const r = spawnSync(
        iscc,
        [
          `/DAppVersion=${pkg.version}`,
          `/DSourceDir=${appDir}`,
          `/DOutputDir=${INSTALLER_OUT}`,
          path.join(SCRIPT_DIR, 'installer-desktop.iss')
        ],
        { stdio: 'inherit' }
      );
      if (r.status !== 0) die('Inno Setup 编译失败');
      const setup = path.join(INSTALLER_OUT, `WorkflowTracker-Desktop-Setup-${pkg.version}.exe`);
      log(`  安装包：${setup}`);
    }
  }

  step('完成');
  log(`  程序目录：${appDir}`);
  log(`  直接运行：${path.join(appDir, 'WorkflowTracker.exe')}`);
}

main().catch((e) => die(e && e.message ? e.message : String(e)));
