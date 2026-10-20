#!/usr/bin/env node
'use strict';

/**
 * Windows 原生版启动器
 *
 * 职责：
 *   1. 读取 / 生成 config.json
 *   2. 准备数据目录（首次启动生成随机管理员密码）
 *   3. 探测端口占用，避免与已有实例冲突
 *   4. 以子进程方式拉起 Next standalone 服务
 *   5. 轮询 /api/health 直到就绪，然后打开默认浏览器
 *
 * 用法：
 *   node launcher.js            启动（已在运行则直接打开浏览器）
 *   node launcher.js --stop     停止
 *   node launcher.js --status   查看状态
 *   node launcher.js --open     仅打开浏览器
 *   node launcher.js --console  前台显示服务日志（默认）
 *   node launcher.js --daemon   后台运行，启动完即退出（供开机自启用）
 *
 * 该文件与 Docker 版共用同一套服务端代码，仅替换了操作系统层面的
 * 进程管理、路径与端口探测，业务逻辑零改动。
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const IS_WIN = process.platform === 'win32';

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const SERVER_JS = path.join(APP_DIR, 'server.js');
const NODE_EXE = IS_WIN
  ? path.join(ROOT, 'runtime', 'node.exe')
  : path.join(ROOT, 'runtime', 'node');
const CONFIG_FILE = path.join(ROOT, 'config.json');

const DEFAULTS = {
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

/* ------------------------------- 工具函数 ------------------------------- */

function log(msg) {
  process.stdout.write(msg + '\n');
}

function box(lines) {
  const width = Math.max(...lines.map((l) => displayWidth(l))) + 2;
  const top = '┌' + '─'.repeat(width) + '┐';
  const bottom = '└' + '─'.repeat(width) + '┘';
  log('');
  log(top);
  for (const l of lines) log('│ ' + l + ' '.repeat(width - displayWidth(l) - 1) + '│');
  log(bottom);
  log('');
}

/** 中文字符按 2 列宽计算，保证边框对齐 */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function loadConfig() {
  const existing = readJson(CONFIG_FILE) || {};
  const cfg = { ...DEFAULTS, ...existing };
  if (!existing.port) {
    writeJson(CONFIG_FILE, cfg);
  }
  return cfg;
}

function resolveDataDir(cfg) {
  return path.isAbsolute(cfg.dataDir) ? cfg.dataDir : path.join(ROOT, cfg.dataDir);
}

function pidFile(cfg) {
  return path.join(resolveDataDir(cfg), 'launcher.pid');
}

function healthOnce(port, host, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/api/health', timeout }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          resolve(j && j.ok ? j.data : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    try {
      srv.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function openBrowser(url) {
  if (IS_WIN) {
    spawn('cmd.exe', ['/c', `start "" "${url}"`], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function killTree(pid) {
  if (!pid) return false;
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * node:sqlite 在 Node 22 需要 --experimental-sqlite，Node 24 起无需该标志。
 * 运行时是内置的，这里按版本自动判断，避免给旧运行时漏参数。
 */
let _nodeMajor = 0;
function nodeMajor() {
  if (_nodeMajor) return _nodeMajor;
  try {
    const out = execFileSync(NODE_EXE, ['-v'], { encoding: 'utf8' }).trim();
    _nodeMajor = Number(out.replace(/^v/, '').split('.')[0]) || 0;
  } catch {
    _nodeMajor = 0;
  }
  return _nodeMajor;
}

function serverArgs() {
  const args = [];
  if (nodeMajor() && nodeMajor() < 24) args.push('--experimental-sqlite');
  args.push(SERVER_JS);
  return args;
}

function readPid(cfg) {
  const f = pidFile(cfg);
  if (!fs.existsSync(f)) return 0;
  const pid = Number(String(fs.readFileSync(f, 'utf8')).trim());
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

/* ------------------------------ 前置环境检查 ------------------------------ */

function preflight() {
  const problems = [];
  if (!fs.existsSync(SERVER_JS)) {
    problems.push(`应用文件缺失：${SERVER_JS}`);
    problems.push('请确认安装完整，或重新运行安装程序。');
  }
  if (!fs.existsSync(NODE_EXE)) {
    problems.push(`内置运行时缺失：${NODE_EXE}`);
    problems.push('请重新安装；便携版需保持 runtime 目录与启动器同级。');
  }
  if (problems.length) {
    box(['启动失败', ...problems]);
    process.exit(1);
  }
}

/* --------------------------------- 启动 --------------------------------- */

async function pickPort(cfg) {
  const host = cfg.host;
  const preferred = Number(cfg.port) || DEFAULTS.port;

  // 已在运行（本机任一端口返回健康）→ 直接复用
  const running = await healthOnce(preferred, host);
  if (running) return { port: preferred, alreadyRunning: true };

  if (await isPortFree(preferred, host)) return { port: preferred, alreadyRunning: false };

  // 端口被别的程序占用：顺延寻找可用端口
  for (let p = preferred + 1; p <= preferred + 30; p++) {
    if (await isPortFree(p, host)) {
      log(`  端口 ${preferred} 已被占用，改用 ${p}`);
      return { port: p, alreadyRunning: false };
    }
  }
  return { port: 0, alreadyRunning: false };
}

function buildEnv(cfg, port, dataDir, adminPassword) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    HOSTNAME: cfg.host,
    DATA_DIR: dataDir,
    TZ: 'Asia/Shanghai',
    COOKIE_SECURE: cfg.cookieSecure ? '1' : '0',
    ADMIN_USERNAME: cfg.adminUsername || 'admin',
    ADMIN_DISPLAY_NAME: cfg.adminDisplayName || '系统管理员'
  };
  if (cfg.vaultDir) env.VAULT_DIR = cfg.vaultDir;
  // 首次启动的随机密码必须传给服务端，否则会退回代码里的默认值
  if (adminPassword) env.ADMIN_PASSWORD = adminPassword;
  Object.assign(env, cfg.extraEnv || {});
  return env;
}

/** 首次启动生成随机管理员密码，并落盘到 data/初始密码.txt */
function prepareFirstRun(cfg, dataDir) {
  const dbFile = path.join(dataDir, 'workflow.db');
  if (fs.existsSync(dbFile)) return null;
  if (cfg.adminPassword) return { username: cfg.adminUsername, password: cfg.adminPassword, fromConfig: true };

  const password = crypto.randomBytes(9).toString('base64url');
  const noteFile = path.join(dataDir, '初始密码.txt');
  fs.writeFileSync(
    noteFile,
    [
      '工作流程跟踪工作台 —— 首次启动生成的登录信息',
      '',
      `用户名：${cfg.adminUsername || 'admin'}`,
      `密码：  ${password}`,
      '',
      '登录后请立即在「系统设置 → 修改密码」中修改，然后删除本文件。',
      `生成时间：${new Date().toLocaleString('zh-CN')}`
    ].join('\r\n'),
    'utf8'
  );
  return { username: cfg.adminUsername, password, noteFile };
}

async function start({ daemon, noOpen }) {
  preflight();
  const cfg = loadConfig();
  if (noOpen) cfg.openBrowser = false;
  const dataDir = resolveDataDir(cfg);
  fs.mkdirSync(dataDir, { recursive: true });

  const { port, alreadyRunning } = await pickPort(cfg);
  if (!port) {
    box(['启动失败', `端口 ${cfg.port} 及后续 30 个端口均被占用。`, '请修改 config.json 中的 port 后重试。']);
    process.exit(1);
  }

  const url = `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${port}`;

  if (alreadyRunning) {
    log(`  服务已在运行：${url}`);
    if (cfg.openBrowser) openBrowser(url);
    return 0;
  }

  const firstRun = prepareFirstRun(cfg, dataDir);
  const env = buildEnv(cfg, port, dataDir, firstRun ? firstRun.password : cfg.adminPassword);

  log('');
  log('  工作流程跟踪工作台 · 正在启动…');
  log(`  数据目录：${dataDir}`);
  log(`  监听地址：${cfg.host}:${port}`);

  const child = spawn(NODE_EXE, serverArgs(), {
    cwd: APP_DIR,
    env,
    stdio: daemon ? 'ignore' : 'inherit',
    windowsHide: daemon
  });

  child.on('error', (e) => {
    box(['启动失败', `无法启动内置运行时：${e.message}`]);
    process.exit(1);
  });

  fs.writeFileSync(pidFile(cfg), String(child.pid), 'utf8');

  // 后台模式：等健康后立即退出，服务继续在后台运行
  if (daemon) child.unref();

  // 前台模式：父进程退出时一并结束子进程
  if (!daemon) {
    const stop = () => {
      try {
        killTree(child.pid);
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(pidFile(cfg), { force: true });
      } catch {
        /* ignore */
      }
    };
    process.on('exit', stop);
    process.on('SIGINT', () => {
      log('\n  正在停止服务…');
      stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      stop();
      process.exit(0);
    });
    process.on('SIGBREAK', () => {
      stop();
      process.exit(0);
    });
  }

  // 等待就绪
  const deadline = Date.now() + 90000;
  let ready = null;
  while (Date.now() < deadline) {
    ready = await healthOnce(port, cfg.host, 2000);
    if (ready) break;
    if (child.exitCode !== null) break;
    await sleep(600);
  }

  if (!ready) {
    box([
      '启动失败',
      '服务在 90 秒内未响应健康检查。',
      '',
      '排查建议：',
      '  1. 查看上方输出的错误信息',
      `  2. 确认 ${cfg.host}:${port} 未被占用`,
      `  3. 确认数据目录可写：${dataDir}`
    ]);
    if (daemon) process.exit(1);
    return 1;
  }

  const lines = [
    '启动成功',
    `访问地址：${url}`,
    ''
  ];
  if (firstRun) {
    lines.push('首次使用，管理员账号：');
    lines.push(`  用户名：${firstRun.username}`);
    lines.push(`  密码：  ${firstRun.password}`);
    if (firstRun.noteFile) lines.push(`  （已保存到 ${firstRun.noteFile}）`);
    lines.push('');
    lines.push('登录后请立即修改密码。');
  }
  if (!IS_WIN) lines.push('提示：非 Windows 系统下服务在后台运行，停止请执行 --stop。');
  else lines.push('关闭本窗口即停止服务（或运行「停止工作台」）。');
  box(lines);

  if (cfg.openBrowser) openBrowser(url);

  if (daemon) {
    process.exit(0);
    return 0;
  }

  // 前台模式：跟随子进程生命周期
  await new Promise((resolve) => {
    child.on('exit', (code) => {
      log(`\n  服务已退出（代码 ${code}）。`);
      resolve(code ?? 0);
    });
  });
  return 0;
}

/* --------------------------------- 其它 --------------------------------- */

function stop() {
  const cfg = loadConfig();
  const pid = readPid(cfg);
  if (!pid) {
    log('  没有检测到运行中的实例。');
    return 0;
  }
  const ok = killTree(pid);
  try {
    fs.rmSync(pidFile(cfg), { force: true });
  } catch {
    /* ignore */
  }
  log(ok ? `  已停止（PID ${pid}）。` : `  停止失败，请手动结束后台进程 ${pid}。`);
  return 0;
}

async function status() {
  const cfg = loadConfig();
  const host = cfg.host;
  const pid = readPid(cfg);
  const h = await healthOnce(Number(cfg.port) || DEFAULTS.port, host, 2500);
  if (h) {
    log(`  运行中：http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${cfg.port}`);
    log(`  PID：${pid || '(未记录)'}`);
    log(`  数据库：${h.db}（主库 ${h.dbSize} B，WAL ${h.walSize ?? 0} B）`);
    log(`  用户数：${h.users}  运行时长：${h.uptime}s  Node ${h.node}`);
    return 0;
  }
  log('  未运行。');
  if (pid) log(`  存在残留 PID 记录（${pid}），可执行 --stop 清理。`);
  return 3;
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);

  if (has('--help') || has('-h')) {
    log(
      [
        '用法：node launcher.js [选项]',
        '',
        '  （无参数）    前台启动，关闭窗口即停止',
        '  --daemon      后台启动，启动完成后自动退出',
        '  --no-open     启动后不自动打开浏览器',
        '  --stop        停止服务',
        '  --status      查看运行状态',
        '  --open        打开页面（不启动服务）',
        '  --console     前台启动（默认行为）',
        '  --help        显示本帮助'
      ].join('\n')
    );
    return Promise.resolve(0);
  }

  if (has('--stop')) return Promise.resolve(stop());
  if (has('--status')) return status();
  if (has('--open')) {
    const cfg = loadConfig();
    const host = cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host;
    openBrowser(`http://${host}:${Number(cfg.port) || DEFAULTS.port}`);
    return Promise.resolve(0);
  }
  return start({ daemon: has('--daemon'), noOpen: has('--no-open') });
}

main()
  .then((code) => {
    if (typeof code === 'number' && code !== 0) process.exitCode = code;
  })
  .catch((e) => {
    box(['运行出错', e && e.message ? e.message : String(e)]);
    process.exitCode = 1;
  });
