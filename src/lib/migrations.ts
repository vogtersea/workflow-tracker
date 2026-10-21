import type { DbLike } from './db';

/**
 * 迁移登记表
 *
 * 设计意图：
 *   - v1 是「基线」——现有的一大段 CREATE TABLE IF NOT EXISTS，由 db.ts 直接执行，
 *     不在这里重复声明；老库（有业务表但没有版本记录）会被回填成 v1。
 *   - v2 起凡涉及「改列类型、拆表、数据回填」的变更，一律走这里登记，
 *     上线前自动 VACUUM INTO 快照，出问题可回退。
 *
 * 约定：
 *   1. 已发布的迁移永不修改，只能追加新版本；
 *   2. up() 必须是幂等的，允许在部分失败后重跑；
 *   3. 不在迁移里做网络请求或读环境变量之外的外部状态。
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: DbLike) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'login_attempts',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          ip       TEXT NOT NULL,
          at       TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_login_attempts
          ON login_attempts(username, ip, at);
      `);
    }
  },
  {
    version: 3,
    name: 'notes_meta',
    up: (db) => {
      // 知识库索引的 mtime 台账；notes_fts 本身按 FTS5 可用性由 fts.ts 惰性创建
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes_meta (
          path  TEXT PRIMARY KEY,
          mtime REAL NOT NULL
        );
      `);
    }
  },
  {
    version: 4,
    name: 'projects',
    up: (db) => {
      // 项目分组：与标签并存（项目回答「属于哪件事」，标签回答「属于哪类事」）
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          color       TEXT NOT NULL DEFAULT '#7f1d1d',
          status      TEXT NOT NULL DEFAULT 'active',
          created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
      `);

      // tasks.project_id 增量列：老库需补列，新库由上面的基线建表
      const cols = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'project_id')) {
        db.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);');
    }
  }
];

/** 当前代码期望的最高版本 */
export const LATEST_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 1);
