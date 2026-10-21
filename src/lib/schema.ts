import type { DbLike, SnapshotHook } from './db-types';
import { MIGRATIONS } from './migrations';

/**
 * 表结构定义（服务端与手机端共用）
 *
 * 抽出来的目的：
 *   1. 保证两端 schema **逐字一致** —— 将来做跨端同步时，表结构不同会直接对不上；
 *   2. 迁移逻辑只有一份，避免服务端升级了、手机端漏了某个 ALTER。
 *
 * 引擎差异只体现在「怎么执行」，不体现在「执行什么」。
 */

/** 基线：所有 CREATE TABLE IF NOT EXISTS，幂等 */
export const BASELINE_SQL = `
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
`;

/** 幂等补列 */
export function ensureColumn(db: DbLike, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * 迁移执行器
 * - 首次升级老库：有业务表但无版本记录 → 回填 v1（基线），不重复建表
 * - 每个待执行迁移前调用 snapshot 钩子做快照（服务端落文件，手机端可省略）
 * - 迁移与版本登记在同一事务内，避免「改了结构但没记版本」
 */
export function runMigrations(
  db: DbLike,
  opts: { snapshot?: SnapshotHook; log?: (msg: string) => void } = {}
) {
  const log = opts.log ?? (() => {});

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const maxRow = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get() as {
    v: number;
  };
  let current = Number(maxRow.v) || 0;

  if (current === 0) {
    // 基线已由 BASELINE_SQL 建好，登记为 v1
    db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (1, ?, ?)').run(
      'baseline',
      new Date().toISOString()
    );
    current = 1;
  }

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    try {
      opts.snapshot?.(m.version);
      db.tx(() => {
        m.up(db);
        db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)').run(
          m.version,
          m.name,
          new Date().toISOString()
        );
      });
      log(`[migrate] 已应用 v${m.version} ${m.name}`);
    } catch (e) {
      log(`[migrate] v${m.version} ${m.name} 执行失败`);
      throw e;
    }
  }
}

/** 建表 + 补列 + 迁移，服务端与手机端共用同一入口 */
export function applySchema(db: DbLike, opts: { snapshot?: SnapshotHook; log?: (msg: string) => void } = {}) {
  db.exec(BASELINE_SQL);
  // 增量列（老库升级）：CREATE TABLE IF NOT EXISTS 不会补列，需显式 ALTER
  ensureColumn(db, 'task_templates', 'month_no', 'INTEGER');
  runMigrations(db, opts);
}
