import type { DbLike } from './db-types';

/**
 * 数据库注册表（同构层）
 *
 * 业务模块（tasks / reports / templates / auth ...）只认这里导出的 getDb()，
 * 不再直接 import 具体实现。这样同一份业务代码既能跑在服务端，
 * 也能跑在手机端浏览器里——两边各自把自己的实现注册进来即可：
 *
 *   服务端  db.ts         → registerDb(() => ...)  ← node:sqlite
 *   手机端  db-browser.ts → registerDb(() => ...)  ← sqlite-wasm + IndexedDB
 *
 * 本文件必须保持零 node 依赖、零浏览器依赖，否则同构就断了。
 */

let _provider: (() => DbLike) | null = null;

/** 由具体实现调用，注册取库函数 */
export function registerDb(provider: () => DbLike): void {
  _provider = provider;
}

export function hasDb(): boolean {
  return _provider !== null;
}

export function getDb(): DbLike {
  if (!_provider) {
    throw new Error('数据库尚未初始化：服务端请 import db.ts，手机端请先 await initBrowserDb()');
  }
  return _provider();
}

// ---------- 通用设置读写（服务端与手机端共用一份，避免两处实现漂移） ----------

export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value);
}

export function getSettings(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = getSetting(k, '');
  return out;
}
