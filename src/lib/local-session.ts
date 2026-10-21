/**
 * 手机端会话存储
 *
 * 浏览器里没法写 httpOnly cookie，会话 token 只能自己存起来。
 * 用 localStorage：容量够、同步读取、应用关闭后仍在。
 *
 * 安全性说明：这是「单机自用」场景，数据本来就在这台设备上，
 * token 泄露的后果等同于拿到手机本身，不做额外加密（加密密钥也只能存在同一处）。
 * 服务端形态仍然走真正的 httpOnly cookie，不受这里影响。
 */

const TOKEN_KEY = 'wt.local.token';

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* 隐私模式或配额满，忽略 */
  }
}

function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

export function getLocalToken(): string | null {
  return safeGet(TOKEN_KEY);
}

export function setLocalToken(token: string): void {
  safeSet(TOKEN_KEY, token);
}

export function clearLocalToken(): void {
  safeRemove(TOKEN_KEY);
}

/**
 * 从 Set-Cookie 头里提取会话令牌并存下。
 * 登录/初始化接口返回的就是标准 Set-Cookie，两端共用同一套响应格式。
 */
export function captureSessionCookie(setCookieValues: string[]): void {
  for (const raw of setCookieValues) {
    const first = raw.split(';')[0] ?? '';
    const idx = first.indexOf('=');
    if (idx < 0) continue;
    const name = first.slice(0, idx).trim();
    if (name !== 'wt_session') continue;
    const value = first.slice(idx + 1).trim();
    if (value) setLocalToken(decodeURIComponent(value));
    else clearLocalToken();
    return;
  }
}
