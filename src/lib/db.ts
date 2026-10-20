import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 数据库连接管理
 *
 * 采用 Node 内置 node:sqlite（Node 22.5+ 需 --experimental-sqlite，Node 24+ 直接可用）。
 * 相比 better-sqlite3 的优势：
 *   - 无原生编译依赖，Docker 镜像构建不需要 python/g++ 工具链
 *   - x86 与 ARM 架构通用，各类 x86 与 ARM 平台都能直接构建
 *   - 镜像体积减少约 30MB
 *
 * 数据库文件本地存放，路径由 DATA_DIR 环境变量控制（默认 ./data），容器内挂载到 NAS 目录。
 */

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'workflow.db');

/** 兼容层：统一暴露 prepare / exec / pragma / tx */
export interface DbLike {
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
  exec: (sql: string) => void;
  pragma: (stmt: string) => void;
  tx: <T>(fn: () => T) => T;
}

let _db: DbLike | null = null;

export function getDb(): DbLike {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  const raw = new DatabaseSync(DB_FILE);

  const db: DbLike = {
    prepare: (sql: string) => {
      const stmt = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          const r = stmt.run(...(params as never[]));
          return {
            changes: Number(r.changes ?? 0),
            lastInsertRowid: Number(r.lastInsertRowid ?? 0)
          };
        },
        get: (...params: unknown[]) => stmt.get(...(params as never[])),
        all: (...params: unknown[]) => stmt.all(...(params as never[]))
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

  migrate(db);
  _db = db;
  return db;
}

export function dbPath(): string {
  return DB_FILE;
}

export function dataDir(): string {
  return DATA_DIR;
}

/** 表结构 — 幂等创建，便于容器重建后自动恢复 */
function migrate(db: DbLike) {
  db.exec(`
    -- ========== 用户 ==========
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'member',
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- ========== 会话 ==========
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- ========== 标签 ==========
    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      color      TEXT NOT NULL DEFAULT '#b91c1c',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- ========== 周期模板 ==========
    CREATE TABLE IF NOT EXISTS task_templates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      detail       TEXT NOT NULL DEFAULT '',
      done_criteria TEXT NOT NULL DEFAULT '',
      cadence      TEXT NOT NULL,
      weekday      INTEGER,
      month_day    INTEGER,
      month_no     INTEGER,
      due_offset   INTEGER NOT NULL DEFAULT 0,
      priority     TEXT NOT NULL DEFAULT 'normal',
      owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      tag_ids      TEXT NOT NULL DEFAULT '[]',
      enabled      INTEGER NOT NULL DEFAULT 1,
      last_run_period TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- ========== 工作项 ==========
    CREATE TABLE IF NOT EXISTS tasks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      detail        TEXT NOT NULL DEFAULT '',
      done_criteria TEXT NOT NULL DEFAULT '',
      due_date      TEXT,
      priority      TEXT NOT NULL DEFAULT 'normal',
      status        TEXT NOT NULL DEFAULT 'open',
      owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      template_id   INTEGER REFERENCES task_templates(id) ON DELETE SET NULL,
      period_label  TEXT,
      week_start    TEXT,
      done_at       TEXT,
      archived_at   TEXT,
      estimate_hours REAL,
      actual_hours  REAL,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      sort_index    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_week ON tasks(week_start);

    -- ========== 工作-标签 关联 ==========
    CREATE TABLE IF NOT EXISTS task_tags (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, tag_id)
    );

    -- ========== 进展记录 ==========
    CREATE TABLE IF NOT EXISTS task_progress (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      percent    INTEGER,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_progress_task ON task_progress(task_id);

    -- ========== 站内通知 ==========
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      level      TEXT NOT NULL DEFAULT 'warn',
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      seen       INTEGER NOT NULL DEFAULT 0,
      dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_noti_user ON notifications(user_id, seen);

    -- ========== 总结报告 ==========
    CREATE TABLE IF NOT EXISTS reports (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      scope        TEXT NOT NULL,
      title        TEXT NOT NULL,
      range_start  TEXT,
      range_end    TEXT,
      task_ids     TEXT NOT NULL DEFAULT '[]',
      content_md   TEXT NOT NULL DEFAULT '',
      model        TEXT,
      tokens       INTEGER,
      status       TEXT NOT NULL DEFAULT 'done',
      error        TEXT,
      created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

    -- ========== 系统设置 ==========
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ========== 审计日志 ==========
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action     TEXT NOT NULL,
      target     TEXT,
      detail     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  // 增量列（老库升级）：CREATE TABLE IF NOT EXISTS 不会补列，需显式 ALTER
  ensureColumn(db, 'task_templates', 'month_no', 'INTEGER');
}

/** 幂等补列 */
function ensureColumn(db: DbLike, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// ---------- 通用设置读写 ----------
export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
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
