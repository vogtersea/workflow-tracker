/**
 * 极简静态服务器 —— 模拟 Capacitor Android 内置 WebView 本地服务
 *
 * Capacitor 在 APK 里就是这样一个「本地静态文件服务器 + 自定义 scheme」，
 * 路由解析规则相同：先试精确文件，再试 path/index.html，再试 path.html。
 * 用它验证 out-local/ 能保证 APK 里行为一致。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.argv[2] || path.join(__dirname, '..', 'out-local');
const PORT = Number(process.env.PORT || 3083);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  const base = path.join(ROOT, pathname);
  const candidates = [
    base,
    base.endsWith('/') ? path.join(base, 'index.html') : path.join(base, 'index.html'),
    base + '.html'
  ];

  let file = null;
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      file = c;
      break;
    }
  }

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found: ' + pathname);
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`静态服务已就绪 http://127.0.0.1:${PORT} → ${ROOT}`);
});
