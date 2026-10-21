import { scryptSync } from './scrypt';

/**
 * 密码学基础函数（同构）
 *
 * 服务端与手机端共用同一份实现，哈希结果逐字节一致：
 *   服务端建的账号可以直接拷到手机端登录，反之亦然。
 *   这是将来做跨平台同步的前提——用户表不需要「换设备就重设密码」。
 *
 * 为什么不用 node:crypto：
 *   浏览器没有它，而纯 JS scrypt 实测与服务端原生实现同速
 *   （N=16384 时约 38ms vs 37ms），没有必要为两端各写一套。
 *
 * 随机数用 Web Crypto 的 getRandomValues：浏览器、WebView、Node 18+ 都提供，
 * 且是密码学安全的——不要换成 Math.random。
 */

const encoder = new TextEncoder();

/** 口令/盐统一按 UTF-8 取字节，与 Node crypto.scryptSync(string, string) 的默认编码一致 */
function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** 定长比较，避免按字节短路泄露信息 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 密码学安全随机字节 */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** 密码学安全随机十六进制串 */
export function randomHex(n: number): string {
  return toHex(randomBytes(n));
}

/**
 * 生成密码哈希，格式与历史数据完全一致：`<32位hex盐>:<128位hex哈希>`
 * 盐是 16 字节随机数，哈希是 scrypt(口令, 盐) 的 64 字节输出。
 */
export function hashPassword(password: string): string {
  const salt = randomHex(16);
  const hash = toHex(scryptSync(utf8(password), utf8(salt), { dkLen: 64 }));
  return `${salt}:${hash}`;
}

/** 校验口令；格式非法或计算异常一律返回 false，不抛错 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const test = toHex(scryptSync(utf8(password), utf8(salt), { dkLen: 64 }));
    return timingSafeEqualHex(hash, test);
  } catch {
    return false;
  }
}

/** 会话 token：32 字节随机数的 hex 表示（与服务端历史 token 同为 64 位 hex） */
export function randomToken(): string {
  return randomHex(32);
}
