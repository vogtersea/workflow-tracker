'use strict';

/**
 * 工作流程跟踪工作台 · 桌面版主进程
 *
 * 设计要点：
 *   1. 用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）跑 Next standalone 服务，
 *      不再额外打包 node.exe，最终只有一个桌面程序。
 *   2. 服务只监听 127.0.0.1 的随机可用端口，页面加载进独立窗口，
 *      没有地址栏、没有浏览器痕迹。
 *   3. 数据落在 %APPDATA%\工作流程跟踪工作台\data，卸载程序也不会删除。
 *   4. 首次运行自动生成随机管理员密码，并在窗口内提示。
 */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PRODUCT = '工作流程跟踪工作台';
const DEFAULT_PORT = 13681;

// 本机环境（杀软注入 / 受限令牌）会导致 Chromium 的 GPU 沙箱子进程崩溃，
// 崩溃后整个应用被带退。这里关硬件加速并放开渲染进程沙箱换取稳定；
// 程序只加载自己的本地页面，不接受外部 URL，风险可控。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

// 访问的是 127.0.0.1，绝不能走系统/环境变量里的代理，
// 否则 http_proxy 指向的代理一旦不可用，页面会直接 ERR_FAILED。
app.commandLine.appendSwitch('no-proxy-server');


// 桌面程序没有控制台，启动异常必须落盘才能排查
let LOG_FILE = '';
function fileLog(msg) {
  try {
    if (!LOG_FILE) LOG_FILE = path.join(app.getPath('userData'), 'app.log');
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\r\n`, 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

process.on('uncaughtException', (e) => {
  fileLog('uncaughtException: ' + (e && e.stack ? e.stack : String(e)));
});
process.on('unhandledRejection', (e) => {
  fileLog('unhandledRejection: ' + (e && e.stack ? e.stack : String(e)));
});

let mainWindow = null;
let serverProc = null;
let serverPort = 0;
let firstRunInfo = null;
let quitting = false;

/* ------------------------------ 路径与配置 ------------------------------ */

function appRoot() {
  // 打包后：<安装目录>\resources\appdata
  // 开发时：用 WT_APP_DIR 指向 .next/standalone
  if (process.env.WT_APP_DIR) return process.env.WT_APP_DIR;
  return path.join(process.resourcesPath, 'appdata');
}

function dataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function readSettings() {
  const file = path.join(app.getPath('userData'), 'config.json');
  const defaults = { port: DEFAULT_PORT, openDevTools: false };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return defaults;
  }
}

/* ------------------------------ 端口与健康检查 ------------------------------ */

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    try {
      s.listen(port, '127.0.0.1');
    } catch {
      resolve(false);
    }
  });
}

async function pickPort(preferred) {
  for (let p = preferred; p <= preferred + 30; p++) {
    if (await isPortFree(p)) return p;
  }
  return 0;
}

function healthCheck(port, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          resolve(!!(j && j.ok));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------ 服务进程 ------------------------------ */

function prepareFirstRun(dir) {
  const dbFile = path.join(dir, 'workflow.db');
  if (fs.existsSync(dbFile)) return null;

  const password = crypto.randomBytes(9).toString('base64url');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '初始密码.txt'),
    [
      `${PRODUCT} —— 首次启动生成的登录信息`,
      '',
      '用户名：admin',
      `密码：  ${password}`,
      '',
      '登录后请立即在「系统设置 → 修改密码」中修改，然后删除本文件。',
      `生成时间：${new Date().toLocaleString('zh-CN')}`
    ].join('\r\n'),
    'utf8'
  );
  return { username: 'admin', password };
}

async function startServer() {
  const root = appRoot();
  const serverJs = path.join(root, 'server.js');
  if (!fs.existsSync(serverJs)) {
    throw new Error(`应用资源缺失：${serverJs}\n请重新安装。`);
  }

  const settings = readSettings();
  serverPort = await pickPort(settings.port || DEFAULT_PORT);
  if (!serverPort) throw new Error(`端口 ${settings.port} 起 30 个范围内均被占用，请检查。`);

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  firstRunInfo = prepareFirstRun(dir);

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(serverPort),
    HOSTNAME: '127.0.0.1',
    DATA_DIR: dir,
    COOKIE_SECURE: '0',
    ADMIN_USERNAME: 'admin',
    ADMIN_DISPLAY_NAME: '系统管理员'
  };
  if (firstRunInfo) env.ADMIN_PASSWORD = firstRunInfo.password;

  serverProc = spawn(process.execPath, [serverJs], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  fileLog('server spawned pid=' + (serverProc.pid || '?'));

  serverProc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  serverProc.stderr.on('data', (d) => {
    process.stderr.write('[server] ' + d);
    fileLog('[server stderr] ' + String(d).trim());
  });
  serverProc.on('exit', (code) => {
    if (!quitting && mainWindow) {
      dialog.showErrorBox('服务已停止', `后台服务意外退出（代码 ${code}）。\n请重新启动程序。`);
    }
  });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await healthCheck(serverPort)) return;
    if (serverProc.exitCode !== null) throw new Error('后台服务启动失败，请查看日志。');
    await sleep(500);
  }
  throw new Error('服务在 90 秒内未就绪。');
}

function stopServer() {
  if (!serverProc) return;
  try {
    serverProc.kill();
  } catch {
    /* ignore */
  }
  serverProc = null;
}

/* ------------------------------ 窗口 ------------------------------ */

const LOADING_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#faf7f2;
       font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:#7f1d1d;flex-direction:column;gap:18px}
  .ring{width:46px;height:46px;border:4px solid #e8d8c8;border-top-color:#b91c1c;border-radius:50%;
        animation:spin 900ms linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .t{font-size:15px;letter-spacing:.08em}
  .s{font-size:12px;color:#9a8574}
</style></head><body>
  <div class="ring"></div>
  <div class="t">工作流程跟踪工作台</div>
  <div class="s">正在启动本地服务…</div>
</body></html>`;

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开数据目录',
          click: () => shell.openPath(dataDir())
        },
        {
          label: '打开备份目录（上级）',
          click: () => shell.openPath(app.getPath('userData'))
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'F5', role: 'reload' },
        { label: '实际大小', accelerator: 'Ctrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'Ctrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'Ctrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '开发者工具', accelerator: 'Ctrl+Shift+I', role: 'toggleDevTools' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: PRODUCT,
              detail:
                `版本 ${app.getVersion()}\n` +
                `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}\n` +
                `Node ${process.versions.node}\n\n` +
                `数据目录：${dataDir()}`,
              buttons: ['确定']
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: PRODUCT,
    backgroundColor: '#faf7f2',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接交给系统浏览器，程序内部不跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML)
  );
}

async function showApp() {
  const url = `http://127.0.0.1:${serverPort}/`;
  await mainWindow.loadURL(url);

  if (firstRunInfo) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '首次使用',
      message: '已自动创建管理员账号',
      detail:
        `用户名：${firstRunInfo.username}\n` +
        `密码：${firstRunInfo.password}\n\n` +
        `该密码同时保存在：\n${path.join(dataDir(), '初始密码.txt')}\n\n` +
        '登录后请立即修改密码。',
      buttons: ['我知道了'],
      noLink: true
    });
    firstRunInfo = null;
  }
}

/* ------------------------------ 生命周期 ------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.setAppUserModelId('com.local.workflowtracker');

  app.whenReady().then(async () => {
    // 双保险：命令行开关之外，再把会话代理强制设为直连
    try {
      await require('electron').session.defaultSession.setProxy({ mode: 'direct' });
    } catch {
      /* 忽略 */
    }
    fileLog('app ready, version=' + app.getVersion());
    fileLog('resourcesPath=' + process.resourcesPath);
    fileLog('appRoot=' + appRoot());
    fileLog('dataDir=' + dataDir());
    try {
      buildMenu();
      createWindow();
      fileLog('window created');
      await startServer();
      fileLog('server ready on port ' + serverPort);
      await showApp();
      fileLog('app loaded');
      if (readSettings().openDevTools) mainWindow.webContents.openDevTools({ mode: 'detach' });
    } catch (e) {
      const msg = e && e.stack ? e.stack : String(e);
      fileLog('startup failed: ' + msg);
      dialog.showErrorBox('启动失败', e && e.message ? e.message : String(e));
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    stopServer();
  });

  app.on('window-all-closed', () => {
    quitting = true;
    stopServer();
    app.quit();
  });
}
