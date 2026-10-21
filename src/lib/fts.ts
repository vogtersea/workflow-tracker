import fs from 'node:fs';
import path from 'node:path';
import { getDb, setSetting } from './db-registry';

/**
 * 知识库全文索引（FTS5）
 *
 * 为什么要探测而不是直接建表：
 *   node:sqlite 是否带 FTS5，取决于 Node 的构建参数，不能靠版本号推断。
 *   发行版、精简镜像、自编译都可能裁掉。所以第一步是探测，失败就回退 LIKE，
 *   并把结果写进 settings（obsidian.fts），便于排查时一眼看到当前走哪条路径。
 *
 * 为什么用 trigram 分词：
 *   中文没有空格，unicode61 会把整段当一个词；trigram 支持任意子串匹配。
 *   代价是索引体积约为主表的 3 倍，对个人知识库可以接受。
 */

const FTS_TABLE = 'notes_fts';
const META_TABLE = 'notes_meta';

let cachedSupport: boolean | null = null;
let lastSyncAt = 0;
const SYNC_INTERVAL_MS = 60_000;

/** 探测当前运行时是否支持 FTS5，结果缓存并落库 */
export function supportsFts5(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  try {
    const db = getDb();
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.__fts5_probe USING fts5(x)');
    db.exec('DROP TABLE temp.__fts5_probe');
    cachedSupport = true;
  } catch {
    cachedSupport = false;
  }
  try {
    setSetting('obsidian.fts', cachedSupport ? '1' : '0');
  } catch {
    /* 设置写入失败不影响检索 */
  }
  return cachedSupport;
}

function ensureTable(): boolean {
  if (!supportsFts5()) return false;
  try {
    getDb().exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE}
        USING fts5(path UNINDEXED, title, body, tokenize='trigram');
    `);
    return true;
  } catch {
    // 例如 trigram 分词器不可用，退化为不支持
    cachedSupport = false;
    try {
      setSetting('obsidian.fts', '0');
    } catch {
      /* ignore */
    }
    return false;
  }
}

export interface IndexAware {
  path: string;
  title: string;
  mtime: string;
}

/**
 * 增量同步：只重写 mtime 变化的文件。
 * 返回 indexed 数量，便于日志与验收。
 */
export function syncIndex(
  vaultPath: string,
  notes: IndexAware[],
  force = false
): { mode: 'fts5' | 'like'; indexed: number } {
  if (!ensureTable()) return { mode: 'like', indexed: 0 };

  const db = getDb();
  const seen = new Set<string>();
  let indexed = 0;

  const getMeta = db.prepare(`SELECT mtime FROM ${META_TABLE} WHERE path = ?`);
  const delFts = db.prepare(`DELETE FROM ${FTS_TABLE} WHERE path = ?`);
  const insFts = db.prepare(`INSERT INTO ${FTS_TABLE} (path, title, body) VALUES (?, ?, ?)`);
  const upMeta = db.prepare(
    `INSERT INTO ${META_TABLE} (path, mtime) VALUES (?, ?)
     ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime`
  );

  db.tx(() => {
    for (const n of notes) {
      seen.add(n.path);
      const mtimeMs = new Date(n.mtime).getTime();
      const cur = getMeta.get(n.path) as { mtime: number } | undefined;
      if (!force && cur && Math.abs(Number(cur.mtime) - mtimeMs) < 1000) continue;

      let content = '';
      try {
        content = fs.readFileSync(path.join(vaultPath, n.path), 'utf-8');
      } catch {
        continue;
      }
      delFts.run(n.path);
      insFts.run(n.path, n.title, content);
      upMeta.run(n.path, mtimeMs);
      indexed++;
    }

    // 已删除的笔记从索引里清掉
    const known = db.prepare(`SELECT path FROM ${META_TABLE}`).all() as { path: string }[];
    for (const row of known) {
      if (!seen.has(row.path)) {
        delFts.run(row.path);
        db.prepare(`DELETE FROM ${META_TABLE} WHERE path = ?`).run(row.path);
      }
    }
  });

  lastSyncAt = Date.now();
  return { mode: 'fts5', indexed };
}

export interface FtsHit {
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

/**
 * 全文检索。trigram 需要 >= 3 字符，1–2 字的中文关键词由调用方回退 LIKE。
 */
export function searchIndex(keyword: string, limit = 20): FtsHit[] {
  if (!ensureTable()) return [];
  const kw = keyword.trim();
  if (kw.length < 3) return [];

  // 整体包成短语，既符合「连续子串」的直觉，也杜绝 MATCH 语法注入
  const phrase = `"${kw.replace(/"/g, '""')}"`;
  try {
    const rows = getDb()
      .prepare(
        `SELECT path, title,
                snippet(${FTS_TABLE}, 2, '〔', '〕', '…', 12) AS snip,
                bm25(${FTS_TABLE}) AS rank
           FROM ${FTS_TABLE}
          WHERE ${FTS_TABLE} MATCH ?
          ORDER BY rank
          LIMIT ?`
      )
      .all(phrase, limit) as { path: string; title: string; snip: string; rank: number }[];
    return rows.map((r) => ({ path: r.path, title: r.title, snippet: r.snip, rank: r.rank }));
  } catch {
    return [];
  }
}

/** 距上次同步是否已超过间隔，供调用方决定要不要重建索引 */
export function indexStale(): boolean {
  return Date.now() - lastSyncAt > SYNC_INTERVAL_MS;
}

/** 供设置页/诊断使用 */
export function ftsStatus(): { supported: boolean; table: string } {
  return { supported: supportsFts5(), table: FTS_TABLE };
}
