/**
 * 同构 HTTP 响应工具
 *
 * 服务端与手机端的 API 处理函数共用这一套返回工具，只依赖标准 Web API
 * （Request / Response / Headers），不依赖 next/server，因此同一份处理代码
 * 既能在 Node 里被 route.ts 调用，也能在浏览器里被本地路由直接调用。
 */

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/** 成功响应：统一 { ok: true, data } */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data }, init);
}

/** 失败响应：统一 { ok: false, error } */
export function fail(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
): Response {
  return Response.json({ ok: false, error: message, ...extra }, { status });
}

/** 安全读取 JSON 体；空体或非法 JSON 返回空对象，避免每个路由重复 try */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export interface CookieOptions {
  maxAge?: number;
  expires?: string;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  secure?: boolean;
}

/** 拼装 Set-Cookie 头值 */
export function buildCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** 构造「清除 cookie」的头值 */
export function clearCookie(name: string, opts: CookieOptions = {}): string {
  return buildCookie(name, '', { ...opts, maxAge: 0, expires: new Date(0).toUTCString() });
}

/** 从响应头里解析出所有 Set-Cookie（浏览器端 fetch 不能直接读，需要 getSetCookie） */
export function readSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}
