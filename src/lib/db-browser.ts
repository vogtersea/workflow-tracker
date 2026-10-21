import type { DbLike, SnapshotHook } from './db-types';
import { applySchema } from './schema';
import { registerDb } from './db-registry';

/**
 * 数据库（浏览器 / 手机端实现）
 *
 * 与服务端 db.ts 实现同一个 DbLike 接口，业务模块（tasks / reports / templates ...）
 * 无需任何改动即可复用。表结构来自 schema.ts，与服务端逐字一致。
 *
 * 为什么不用 OPFS：
 *   Android WebView 主线程拿不到 FileSystemFileHandle.createSyncAccessHandle，
 *   官方 OPFS VFS 与 SAHPool VFS 都不可用（实测 sah=false）。
 *
 * 方案：
 *   内存 SQLite（sqlite3.oo1.DB(':memory:')）提供同步 API，
 *   写入后按检查点把整库导出为字节，落到 IndexedDB。
 *   数据量在几 MB 量级时，导出约几十毫秒，用户无感。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Sqlite3 = any;

const IDB_NAME = 'wt-local';
const IDB_STORE = 'files';
const DB_KEY = 'workflow.db';

/** 写入后延迟落盘，避免连续写触发多次导出 */
const SAVE_DEBOUNCE_MS = 400;

let _sqlite3: Sqlite3 | null = null;
let _raw: any = null;
let _db: DbLike | null = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _ready = false;
/** 是否已挂上 pagehide/visibilitychange 兜底落盘 */
let _hooksBound = false;

export interface InitOptions {
  /** wasm 文件位置解析，默认按模块目录推导 */
  locateFile?: (file: string) => string;
  /** 迁移前快照钩子，手机端默认不做文件快照 */
  snapshot?: SnapshotHook;
  /** 是否打印迁移日志 */
  log?: (msg: string) => void;
}

// ---------------- IndexedDB 最小封装 ----------------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  const db = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// ---------------- 落盘 ----------------

/** 立即把整库导出并写入 IndexedDB */
export async function flushNow(): Promise<number> {
  if (!_sqlite3 || !_raw) return 0;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  const bytes: Uint8Array = _sqlite3.capi.sqlite3_js_db_export(_raw);
  // 复制成独立 ArrayBuffer，避免 wasm 堆被回收后数据失效
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await idbPut(DB_KEY, copy.buffer);
  return copy.byteLength;
}

/** 安排一次延迟落盘；写操作后调用 */
export function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    void flushNow();
  }, SAVE_DEBOUNCE_MS);
}

function bindLifecycleHooks(): void {
  if (_hooksBound || typeof window === 'undefined') return;
  _hooksBound = true;
  // 切后台或关闭前强制落盘，尽量不丢最后几百毫秒的写入
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushNow();
  });
  window.addEventListener('pagehide', () => {
    void flushNow();
  });
}

// ---------------- DbLike 适配 ----------------

function wrap(raw: any, sqlite3: Sqlite3): DbLike {
  const flushSoon = () => scheduleSave();
  // oo1 的 bind 在「没有可绑定参数」时传空数组会抛错，
  // 所以无参语句必须走不传 bind 的分支。
  const hasParams = (p: unknown[]) => p.length > 0;

  return {
    prepare: (sql: string) => ({
      run: (...params: unknown[]) => {
        raw.exec(hasParams(params) ? { sql, bind: params as never } : { sql });
        const changes = Number(raw.changes() ?? 0);
        const lastInsertRowid = Number(
          raw.selectValue('SELECT last_insert_rowid()') ?? 0
        );
        flushSoon();
        return { changes, lastInsertRowid };
      },
      get: (...params: unknown[]) =>
        (hasParams(params)
          ? raw.selectObject(sql, params as never)
          : raw.selectObject(sql)) ?? undefined,
      all: (...params: unknown[]) =>
        (hasParams(params)
          ? raw.selectObjects(sql, params as never)
          : raw.selectObjects(sql)) ?? []
    }),

    exec: (sql: string) => {
      raw.exec(sql);
      flushSoon();
    },

    pragma: (stmt: string) => {
      raw.exec(`PRAGMA ${stmt}`);
    },

    tx: <T,>(fn: () => T): T => {
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
        flushSoon();
        return out;
      } catch (e) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          /* 忽略回滚失败 */
        }
        throw e;
      }
    }
  };
}

// ---------------- 对外 ----------------

/**
 * 初始化本地数据库。
 * 必须在渲染任何读取数据的界面之前 await 一次，之后 getDb() 才是同步可用的。
 */
export async function initBrowserDb(opts: InitOptions = {}): Promise<void> {
  if (_ready) return;

  const mod: any = await import('@sqlite.org/sqlite-wasm');
  const init = mod.default ?? mod.sqlite3InitModule;
  _sqlite3 = await init({
    locateFile: opts.locateFile ?? ((f: string) => `/${f}`)
  });

  // 有历史数据就恢复，没有就新建空库
  const saved = await idbGet(DB_KEY);
  if (saved && saved.byteLength > 0) {
    _raw = new _sqlite3.oo1.DB(':memory:', 'c');
    const bytes = new Uint8Array(saved);
    const ptr = _sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = _sqlite3.capi.sqlite3_deserialize(
      _raw.pointer,
      'main',
      ptr,
      bytes.byteLength,
      bytes.byteLength,
      _sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | _sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
    );
    if (rc !== 0) {
      // 数据损坏时不能让应用起不来，降级为空库并把坏档另存一份
      console.error('[db-browser] 反序列化失败 rc=', rc, '，将以空库启动');
      await idbPut(`${DB_KEY}.broken-${Date.now()}`, saved);
      _raw = new _sqlite3.oo1.DB(':memory:', 'c');
    }
  } else {
    _raw = new _sqlite3.oo1.DB(':memory:', 'c');
  }

  _db = wrap(_raw, _sqlite3);
  _db.pragma('foreign_keys = ON');

  applySchema(_db, { snapshot: opts.snapshot, log: opts.log });

  bindLifecycleHooks();
  _ready = true;

  // 首次建库后立刻落一次盘，避免用户直接杀掉进程导致空库
  await flushNow();
}

export function isBrowserDbReady(): boolean {
  return _ready;
}

export function getDb(): DbLike {
  if (!_db) {
    throw new Error('本地数据库尚未初始化，请先 await initBrowserDb()');
  }
  return _db;
}

export function dbPath(): string {
  return `indexeddb://${IDB_NAME}/${DB_KEY}`;
}

export function dataDir(): string {
  return `indexeddb://${IDB_NAME}`;
}

/** 向同构层注册浏览器实现；业务模块据此在手机端也能拿到库 */
registerDb(getDb);

// ---------- 通用设置读写 ----------
// 实现统一在 db-registry.ts，与 db.ts 共用同一份，避免两端漂移
export { getSetting, setSetting, getSettings } from './db-registry';

// ---------- 备份 / 恢复 ----------

/** 导出一份 sqlite 字节，供用户另存为备份文件 */
export function exportDatabase(): Uint8Array {
  if (!_sqlite3 || !_raw) throw new Error('数据库未初始化');
  return _sqlite3.capi.sqlite3_js_db_export(_raw);
}

/** 用备份文件覆盖当前库（调用方需自行确认） */
export async function importDatabase(bytes: Uint8Array): Promise<void> {
  if (!_sqlite3) throw new Error('数据库未初始化');
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  _raw = new _sqlite3.oo1.DB(':memory:', 'c');
  const ptr = _sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = _sqlite3.capi.sqlite3_deserialize(
    _raw.pointer,
    'main',
    ptr,
    bytes.byteLength,
    bytes.byteLength,
    _sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | _sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
  );
  if (rc !== 0) throw new Error(`备份文件无法读取（rc=${rc}）`);
  _db = wrap(_raw, _sqlite3);
  _db.pragma('foreign_keys = ON');
  applySchema(_db, {});
  await flushNow();
}
