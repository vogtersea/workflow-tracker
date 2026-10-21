import * as authApi from './api/auth';
import * as badgesApi from './api/badges';
import * as dashboardApi from './api/dashboard';
import * as healthApi from './api/health';
import * as notificationsApi from './api/notifications';
import * as obsidianApi from './api/obsidian';
import * as projectDetailApi from './api/project-detail';
import * as projectsApi from './api/projects';
import * as reportDetailApi from './api/report-detail';
import * as reportExportApi from './api/report-export';
import * as reportsApi from './api/reports';
import * as settingsApi from './api/settings';
import * as tagsApi from './api/tags';
import * as taskDetailApi from './api/task-detail';
import * as taskProgressApi from './api/task-progress';
import * as tasksApi from './api/tasks';
import * as templatesApi from './api/templates';
import * as usersApi from './api/users';
import * as weekApi from './api/week';

import { readSetCookies } from './api/http';
import { captureSessionCookie, clearLocalToken, getLocalToken, setLocalToken } from './local-session';
import { dbPath, dataDir } from './db-browser';

/**
 * 本地路由分发
 *
 * 手机单机版没有服务器，但页面代码调用的仍然是 /api/xxx。
 * 这里按「方法 + 路径」把请求分发给 lib/api 下的同构处理函数——
 * 与服务端 route.ts 调用的是**同一批函数**，所以两端行为不会有差异。
 *
 * cookie 处理：
 *   请求方向把本地存的 token 塞进 cookie 头，让 auth.ts 的解析逻辑原样生效；
 *   响应方向截获 Set-Cookie 存回本地存储，登录/登出因此与服务端同一套语义。
 */

type Params = Record<string, string>;

interface Route {
  method: string;
  re: RegExp;
  /** 正则捕获组按顺序对应的参数名 */
  names: string[];
  handler: (req: Request, p: Params) => Promise<Response>;
}

/** 手机端没有文件系统，Obsidian 相关能力注入空实现，界面会显示「未配置」引导 */
const localObsidian: obsidianApi.ObsidianAdapter = {
  vaultEnabled: () => false,
  vaultDir: () => '',
  vaultTree: () => ({}),
  searchNotes: () => [],
  readNote: () => null,
  listNotes: () => []
};

/** 设置页读取的 Obsidian 探测信息，手机端同样为空 */
const localObsidianMeta: settingsApi.ObsidianMeta = {
  vaultEnabled: () => false,
  vaultDir: () => '',
  vaultDirSource: () => '',
  writebackSubdir: () => ''
};

const ROUTES: Route[] = [
  // ---------- 认证 ----------
  { method: 'POST', re: /^\/api\/auth\/login\/?$/, names: [], handler: (r) => authApi.authLogin(r) },
  { method: 'POST', re: /^\/api\/auth\/logout\/?$/, names: [], handler: (r) => authApi.authLogout(r) },
  { method: 'GET', re: /^\/api\/auth\/me\/?$/, names: [], handler: (r) => authApi.authMe(r) },
  { method: 'POST', re: /^\/api\/auth\/setup\/?$/, names: [], handler: (r) => authApi.authSetup(r) },

  // ---------- 工作台 ----------
  { method: 'GET', re: /^\/api\/dashboard\/?$/, names: [], handler: (r) => dashboardApi.dashboardGet(r) },
  { method: 'GET', re: /^\/api\/dashboard\/badges\/?$/, names: [], handler: (r) => badgesApi.badgesGet(r) },

  // ---------- 工作 ----------
  { method: 'GET', re: /^\/api\/tasks\/?$/, names: [], handler: (r) => tasksApi.tasksGet(r) },
  { method: 'POST', re: /^\/api\/tasks\/?$/, names: [], handler: (r) => tasksApi.tasksPost(r) },
  { method: 'GET', re: /^\/api\/tasks\/([^/]+)$/, names: ['id'], handler: (r, p) => taskDetailApi.taskDetailGet(r, p.id) },
  { method: 'PATCH', re: /^\/api\/tasks\/([^/]+)$/, names: ['id'], handler: (r, p) => taskDetailApi.taskDetailPatch(r, p.id) },
  { method: 'DELETE', re: /^\/api\/tasks\/([^/]+)$/, names: ['id'], handler: (r, p) => taskDetailApi.taskDetailDelete(r, p.id) },
  { method: 'POST', re: /^\/api\/tasks\/([^/]+)$/, names: ['id'], handler: (r, p) => taskDetailApi.taskDetailPost(r, p.id) },
  { method: 'DELETE', re: /^\/api\/tasks\/([^/]+)\/progress$/, names: ['id'], handler: (r, p) => taskProgressApi.taskProgressDelete(r, p.id) },

  // ---------- 例行固定工作 ----------
  { method: 'GET', re: /^\/api\/templates\/?$/, names: [], handler: (r) => templatesApi.templatesGet(r) },
  { method: 'POST', re: /^\/api\/templates\/?$/, names: [], handler: (r) => templatesApi.templatesPost(r) },
  { method: 'PATCH', re: /^\/api\/templates\/?$/, names: [], handler: (r) => templatesApi.templatesPatch(r) },
  { method: 'DELETE', re: /^\/api\/templates\/?$/, names: [], handler: (r) => templatesApi.templatesDelete(r) },
  { method: 'PUT', re: /^\/api\/templates\/?$/, names: [], handler: (r) => templatesApi.templatesPut(r) },

  // ---------- 项目 ----------
  { method: 'GET', re: /^\/api\/projects\/?$/, names: [], handler: (r) => projectsApi.projectsGet(r) },
  { method: 'POST', re: /^\/api\/projects\/?$/, names: [], handler: (r) => projectsApi.projectsPost(r) },
  { method: 'DELETE', re: /^\/api\/projects\/?$/, names: [], handler: (r) => projectsApi.projectsDelete(r) },
  { method: 'PATCH', re: /^\/api\/projects\/([^/]+)$/, names: ['id'], handler: (r, p) => projectDetailApi.projectDetailPatch(r, p.id) },
  { method: 'DELETE', re: /^\/api\/projects\/([^/]+)$/, names: ['id'], handler: (r, p) => projectDetailApi.projectDetailDelete(r, p.id) },

  // ---------- 标签 ----------
  { method: 'GET', re: /^\/api\/tags\/?$/, names: [], handler: (r) => tagsApi.tagsGet(r) },
  { method: 'POST', re: /^\/api\/tags\/?$/, names: [], handler: (r) => tagsApi.tagsPost(r) },
  { method: 'DELETE', re: /^\/api\/tags\/?$/, names: [], handler: (r) => tagsApi.tagsDelete(r) },

  // ---------- 报告 ----------
  { method: 'GET', re: /^\/api\/reports\/?$/, names: [], handler: (r) => reportsApi.reportsGet(r) },
  { method: 'POST', re: /^\/api\/reports\/?$/, names: [], handler: (r) => reportsApi.reportsPost(r) },
  { method: 'GET', re: /^\/api\/reports\/([^/]+)\/export$/, names: ['id'], handler: (r, p) =>
      reportExportApi.reportExportGet(r, p.id, {
        vaultEnabled: () => false,
        writeReportToVault: () => ({ ok: false, message: '本机版无法写回 Obsidian 知识库，请在电脑端操作' })
      })
  },
  { method: 'GET', re: /^\/api\/reports\/([^/]+)$/, names: ['id'], handler: (r, p) => reportDetailApi.reportGet(r, p.id) },
  { method: 'PATCH', re: /^\/api\/reports\/([^/]+)$/, names: ['id'], handler: (r, p) => reportDetailApi.reportPatch(r, p.id) },
  { method: 'DELETE', re: /^\/api\/reports\/([^/]+)$/, names: ['id'], handler: (r, p) => reportDetailApi.reportDelete(r, p.id) },

  // ---------- 设置 ----------
  { method: 'GET', re: /^\/api\/settings\/?$/, names: [], handler: (r) =>
      settingsApi.settingsGet(r, {
        dbPath: dbPath(),
        dataDir: dataDir(),
        dbSize: 0,
        nodeVersion: 'web',
        obsidian: localObsidianMeta
      })
  },
  { method: 'POST', re: /^\/api\/settings\/?$/, names: [], handler: (r) => settingsApi.settingsPost(r) },

  // ---------- 用户 ----------
  { method: 'GET', re: /^\/api\/users\/?$/, names: [], handler: (r) => usersApi.usersGet(r) },
  { method: 'POST', re: /^\/api\/users\/?$/, names: [], handler: (r) => usersApi.usersPost(r) },
  { method: 'PATCH', re: /^\/api\/users\/?$/, names: [], handler: (r) => usersApi.usersPatch(r) },
  { method: 'DELETE', re: /^\/api\/users\/?$/, names: [], handler: (r) => usersApi.usersDelete(r) },

  // ---------- 通知 / 周视图 / 知识库 / 健康 ----------
  { method: 'GET', re: /^\/api\/notifications\/?$/, names: [], handler: (r) => notificationsApi.notificationsGet(r) },
  { method: 'POST', re: /^\/api\/notifications\/?$/, names: [], handler: (r) => notificationsApi.notificationsPost(r) },
  { method: 'GET', re: /^\/api\/week\/?$/, names: [], handler: (r) => weekApi.weekGet(r) },
  { method: 'GET', re: /^\/api\/obsidian\/?$/, names: [], handler: (r) => obsidianApi.obsidianGet(r, localObsidian) },
  { method: 'GET', re: /^\/api\/health\/?$/, names: [], handler: () =>
      healthApi.healthGet({
        dbPath: dbPath(),
        fileSize: () => 0,
        runtime: { node: 'web', uptime: 0 }
      })
  }
];

const BASE = 'http://local.invalid';

function buildRequest(url: URL, method: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);

  /**
   * 会话令牌走自定义头，不用 Cookie：
   * 浏览器的 Request 把 Cookie 列为禁用请求头，脚本设置会被静默丢弃，
   * 发出去就是个没有会话的请求，表现为「登录成功却立刻被踢回登录页」。
   */
  const token = getLocalToken();
  if (token) headers.set('x-wt-session', token);

  // 登录节流按 ip 计数，本机固定一个标识即可
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', '127.0.0.1');

  const noBody = method === 'GET' || method === 'HEAD';
  return new Request(url.toString(), {
    method,
    headers,
    body: noBody ? undefined : (init?.body as BodyInit | null | undefined)
  });
}

function notFound(method: string, pathname: string): Response {
  return Response.json(
    { ok: false, error: `本机版暂不支持该接口：${method} ${pathname}` },
    { status: 404 }
  );
}

/** 本地模式下的「fetch」：签名与用法都和原生 fetch 一致 */
export async function localFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, BASE);
  const method = (init?.method || 'GET').toUpperCase();

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = url.pathname.match(route.re);
    if (!m) continue;

    const params: Params = {};
    route.names.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1] ?? '');
    });

    const res = await route.handler(buildRequest(url, method, init), params);

    /**
     * 会话令牌落到本地存储。
     *
     * 优先读自定义头：浏览器把 Set-Cookie 列为禁用响应头，脚本既写不进也读不出
     * （实测合成 Response 上 getSetCookie() 恒为空数组），单机版没有真实 HTTP 响应，
     * 只能靠这个头把令牌带出来。Set-Cookie 分支留给将来做 WebView 内嵌服务时复用。
     */
    const headerToken = res.headers.get('x-wt-session');
    if (headerToken !== null) {
      if (headerToken) setLocalToken(headerToken);
      else clearLocalToken();
    } else {
      const cookies = readSetCookies(res);
      if (cookies.length) captureSessionCookie(cookies);
    }

    return res;
  }

  return notFound(method, url.pathname);
}
