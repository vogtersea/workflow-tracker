import { IS_LOCAL_BUILD, enableLocalMode } from './runtime-mode';
import { getLocalToken } from './local-session';

/**
 * 手机单机版启动流程
 *
 * 顺序很重要：先把浏览器端 SQLite 建好（含建表与迁移），再注册「当前用户」解析器，
 * 最后才切到本地模式。三步都完成前，任何 api() 调用都会打到不存在的服务器上。
 *
 * 服务端版构建里 IS_LOCAL_BUILD 是编译期常量 false，
 * 下面的动态导入会被整体摇掉——服务端产物里不含 db-browser 与 879KB 的 wasm。
 */

let _boot: Promise<void> | null = null;

export function ensureBooted(): Promise<void> {
  if (!IS_LOCAL_BUILD) return Promise.resolve();
  return (_boot ??= boot());
}

async function boot(): Promise<void> {
  const [{ initBrowserDb }, auth] = await Promise.all([import('./db-browser'), import('./auth')]);

  await initBrowserDb();

  auth.setCurrentUserResolver(async () => {
    const token = getLocalToken();
    return token ? auth.userFromToken(token) : null;
  });

  enableLocalMode();
}
