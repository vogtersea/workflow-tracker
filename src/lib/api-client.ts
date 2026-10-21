import { IS_LOCAL_BUILD, isLocalMode } from './runtime-mode';

/**
 * 统一请求入口
 *
 * 所有页面都通过 api('/api/xxx') 访问数据，不再直接 fetch。
 *
 *   服务端形态（Docker / Windows 服务版）：直通原生 fetch，行为与改造前完全一致
 *   手机单机形态：转给 api-router，在浏览器内的 SQLite 上直接执行同一份处理逻辑
 *
 * 页面代码因此不需要知道自己跑在哪种形态里，也不需要维护两套数据访问代码。
 *
 * 本地实现用动态 import：IS_LOCAL_BUILD 是编译期常量，服务端版构建时整个分支
 * 会被摇树移除，产物里不会出现 router、业务库与 sqlite-wasm。
 */

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return (input as Request).url;
}

export async function api(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = toUrl(input);
  if (IS_LOCAL_BUILD && isLocalMode()) {
    const { localFetch } = await import('./api-router');
    return localFetch(url, init);
  }
  return fetch(input as RequestInfo, init);
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  [k: string]: unknown;
}

/** 常用便捷封装：返回解析后的信封，网络异常也归一成 ok:false */
export async function apiJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<ApiEnvelope<T>> {
  try {
    const res = await api(input, init);
    return (await res.json()) as ApiEnvelope<T>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络请求失败' };
  }
}
