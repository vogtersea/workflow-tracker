import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { applySchema } from './schema';
import { registerDb } from './db-registry';
import type { DbLike } from './db-types';

/**
 * 数据库连接管理（服务端实现）
 *
 * 采用 Node 内置 node:sqlite（Node 22.5+ 需 --experimental-sqlite，Node 24+ 直接可用）。
 * 相比 better-sqlite3 的优势：
 *   - 无原生编译依赖，Docker 镜像构建不需要 python/g++ 工具链
 *   - x86 与 ARM 架构通用，各类 x86 与 ARM 平台都能直接构建
 *   - 镜像体积减少约 30MB
 *
 * 数据库文件本地存放，路径由 DATA_DIR 环境变量控制（默认 ./data），容器内挂载到 NAS 目录。
 *
 * 手机/浏览器端见 db-browser.ts：两者实现同一个 DbLike 接口，
 * 表结构统一由 schema.ts 提供，保证跨端 schema 一致。
 */

/** 兼容层接口从 db-types 提供，这里再导出一次，历史 import 无需改动 */
export type { DbLike };

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'workflow.db');

/** 同步 SQL 超过该阈值即认为可能阻塞事件循环，打 warn 供事后判断 */
const SLOW_SQL_MS = Number(process.env.SLOW_SQL_MS || 100);

let _db: DbLike | null = null;

export function getDb(): DbLike {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  const raw = new DatabaseSync(DB_FILE);

  const db: DbLike = {
    prepare: (sql: string) => {
      const stmt = raw.prepare(sql);
      // 慢查询打点：node:sqlite 是同步 API，超过阈值会阻塞事件循环，
      // 先用数据判断是否需要 worker_threads，不预先上线程池。
      const timed = <T>(fn: () => T): T => {
        const t0 = performance.now();
        try {
          return fn();
        } finally {
          const cost = performance.now() - t0;
          if (cost > SLOW_SQL_MS) {
            console.warn(`[slow-sql] ${cost.toFixed(0)}ms`, sql.replace(/\s+/g, ' ').slice(0, 120));
          }
        }
      };
      return {
        run: (...params: unknown[]) => {
          const r = stmt.run(...(params as never[]));
          return {
            changes: Number(r.changes ?? 0),
            lastInsertRowid: Number(r.lastInsertRowid ?? 0)
          };
        },
        get: (...params: unknown[]) => timed(() => stmt.get(...(params as never[]))),
        all: (...params: unknown[]) => timed(() => stmt.all(...(params as never[])))
      };
    },
    exec: (sql: string) => raw.exec(sql),
    pragma: (stmt: string) => {
      raw.exec(`PRAGMA ${stmt}`);
    },
    tx: <T,>(fn: () => T): T => {
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
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

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  // 表结构与迁移统一由 schema.ts 提供，服务端只负责提供快照钩子
  applySchema(db, { snapshot: (v) => snapshotBefore(db, v), log: console.log });

  _db = db;
  return db;
}

/** 迁移前快照，落在 data/backups 下；失败不阻断迁移（只警告） */
function snapshotBefore(db: DbLike, version: number) {
  try {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `pre-v${version}-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } catch (e) {
    console.warn('[migrate] 快照失败，继续执行迁移', e);
  }
}

export function dbPath(): string {
  return DB_FILE;
}

export function dataDir(): string {
  return DATA_DIR;
}

// ---------- 通用设置读写 ----------
// 实现已统一到 db-registry.ts（服务端与手机端共用一份），这里转出口保持历史 import 可用
export { getSetting, setSetting, getSettings } from './db-registry';

/**
 * 向同构层注册服务端实现。
 *
 * 业务模块统一从 db-registry 取库，因此本模块必须在服务端启动时被求值一次，
 * 由 src/instrumentation.ts 负责；直接 import db.ts 的地方（健康检查、设置页）也会自然触发。
 */
registerDb(getDb);
