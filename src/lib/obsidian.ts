import fs from 'node:fs';
import path from 'node:path';
import { getSetting } from './db-registry';
import { supportsFts5, syncIndex, searchIndex, indexStale } from './fts';

/**
 * Obsidian 知识库集成
 * - 只读检索：以 VAULT_DIR 环境变量挂载 vault 目录，按关键词检索 .md 文件
 * - 写回：把报告写成带 frontmatter 的 .md，落入指定子目录
 *
 * 设计取舍：
 *  - 不做双向同步，避免与 remotely-save 产生写冲突
 *  - 写回文件带唯一标识与时间戳，重名时自动加后缀，绝不覆盖已有笔记
 *  - 索引在内存中按需构建并缓存，文件数在数千级时可秒级完成
 */

export interface VaultNote {
  path: string;      // 相对 vault 的路径
  title: string;     // 文件名（去扩展名）
  folder: string;
  size: number;
  mtime: string;
  excerpt?: string;
  score?: number;
}

/**
 * 知识库根目录解析
 *
 * 优先级：界面设置 > 环境变量 > 默认挂载点 /vault
 *
 * 说明：容器只能访问已挂载的目录，因此「挂载点」必须在部署时由 compose 决定，
 * 无法在运行期变更。但「使用挂载点下的哪个路径」可以放到界面里改，
 * 所以这里让界面设置优先于环境变量，避免 compose 里的 VAULT_DIR 把界面配置锁死。
 */
export function vaultDir(): string {
  const fromUi = getSetting('obsidian.vaultDir', '').trim();
  if (fromUi) return fromUi;

  const fromEnv = (process.env.VAULT_DIR || '').trim();
  if (fromEnv) return fromEnv;

  // 兜底：compose 默认挂载到 /vault，存在即用
  if (fs.existsSync('/vault')) return '/vault';
  return '';
}

/** 配置来源，供界面提示用 */
export function vaultDirSource(): 'ui' | 'env' | 'default' | 'none' {
  if (getSetting('obsidian.vaultDir', '').trim()) return 'ui';
  if ((process.env.VAULT_DIR || '').trim()) return 'env';
  if (fs.existsSync('/vault')) return 'default';
  return 'none';
}

export function vaultEnabled(): boolean {
  const dir = vaultDir();
  return Boolean(dir && fs.existsSync(dir));
}

export function writebackSubdir(): string {
  return getSetting('obsidian.writebackSubdir', '99-收件箱');
}

/** 递归列出 md 文件（带缓存，60 秒过期） */
interface CacheEntry {
  at: number;
  notes: VaultNote[];
}
let cache: CacheEntry | null = null;

function walk(dir: string, base: string, out: VaultNote[], depth = 0) {
  if (depth > 12) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, base, out, depth + 1);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      try {
        const st = fs.statSync(full);
        const rel = path.relative(base, full).split(path.sep).join('/');
        out.push({
          path: rel,
          title: e.name.replace(/\.md$/i, ''),
          folder: path.dirname(rel) === '.' ? '' : path.dirname(rel).split(path.sep).join('/'),
          size: st.size,
          mtime: st.mtime.toISOString()
        });
      } catch {
        /* 跳过不可读文件 */
      }
    }
  }
}

export function listNotes(force = false): VaultNote[] {
  const dir = vaultDir();
  if (!dir || !fs.existsSync(dir)) return [];
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.notes;
  const out: VaultNote[] = [];
  walk(dir, dir, out);
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  cache = { at: Date.now(), notes: out };
  return out;
}

/** 读取笔记全文，做路径越界防护 */
export function readNote(relPath: string): { path: string; content: string } | null {
  const dir = vaultDir();
  if (!dir) return null;
  const root = path.resolve(dir);
  const target = path.resolve(root, relPath);
  // 防目录穿越
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  if (!fs.existsSync(target)) return null;
  const content = fs.readFileSync(target, 'utf-8');
  return { path: relPath, content };
}

/** 关键词检索：优先走 FTS5 索引，短词或索引不可用时回退逐篇 LIKE */
export function searchNotes(keyword: string, limit = 20): VaultNote[] {
  const notes = listNotes();
  if (!keyword.trim()) return notes.slice(0, limit);

  const dir = vaultDir();
  const kw = keyword.trim();

  // FTS5 分支：避免「每次检索都把所有笔记读一遍」
  if (dir && kw.length >= 3 && supportsFts5()) {
    try {
      if (indexStale()) syncIndex(dir, notes);
      const hits = searchIndex(kw, limit);
      if (hits.length) {
        const byPath = new Map(notes.map((n) => [n.path, n]));
        const out: VaultNote[] = [];
        hits.forEach((h, i) => {
          const base = byPath.get(h.path);
          if (base) out.push({ ...base, excerpt: h.snippet, score: 100 - i });
        });
        if (out.length) return out;
      }
    } catch {
      /* 索引异常一律回退 LIKE，不影响可用性 */
    }
  }

  const terms = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (!terms.length) return [];

  const results: VaultNote[] = [];

  for (const n of notes) {
    let score = 0;
    const lowerTitle = n.title.toLowerCase();
    const lowerPath = n.path.toLowerCase();

    for (const term of terms) {
      if (lowerTitle.includes(term)) score += 10;
      if (lowerPath.includes(term)) score += 4;
    }

    // 正文检索
    let excerpt = '';
    try {
      const full = path.join(dir!, n.path);
      const content = fs.readFileSync(full, 'utf-8');
      const lower = content.toLowerCase();
      for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx >= 0) {
          score += 3;
          if (!excerpt) {
            const start = Math.max(0, idx - 40);
            excerpt = content
              .slice(start, idx + 120)
              .replace(/[\r\n]+/g, ' ')
              .trim();
          }
        }
      }
      // frontmatter tags 命中加权
      const fm = content.slice(0, 600);
      for (const term of terms) {
        if (fm.toLowerCase().includes(`tags`) && fm.toLowerCase().includes(term)) score += 2;
      }
    } catch {
      continue;
    }

    if (score > 0) results.push({ ...n, score, excerpt });
  }

  results.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.mtime < b.mtime ? 1 : -1));
  return results.slice(0, limit);
}

export interface WritebackOptions {
  title: string;
  contentMd: string;
  tags?: string[];
  category?: string;
  subdir?: string;
}

/**
 * 写回报告为 md 文件
 * 命名规则遵循用户既有约定：主题-文档类型.md，不加日期前缀
 * 若同名文件已存在，追加 -2、-3 后缀，绝不覆盖
 */
export function writeReportToVault(opts: WritebackOptions): { ok: boolean; path?: string; message: string } {
  const dir = vaultDir();
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, message: '未配置 Obsidian 知识库目录，或目录不可访问' };
  }

  const sub = opts.subdir ?? writebackSubdir();
  const targetDir = path.join(dir, sub);
  const root = path.resolve(dir);
  const resolved = path.resolve(targetDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return { ok: false, message: '目标目录越界，已拒绝写入' };
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    return { ok: false, message: `创建目录失败：${e instanceof Error ? e.message : String(e)}` };
  }

  // 文件名清洗：去掉非法字符
  const safeTitle = opts.title.replace(/[\\/:*?"<>|\r\n]/g, '').trim().slice(0, 80) || '工作总结';
  let filename = `${safeTitle}.md`;
  let full = path.join(targetDir, filename);
  let seq = 2;
  while (fs.existsSync(full)) {
    filename = `${safeTitle}-${seq}.md`;
    full = path.join(targetDir, filename);
    seq++;
    if (seq > 99) break;
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const created = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tags = ['WorkBuddy', ...(opts.tags || [])];

  const frontmatter = [
    '---',
    `title: "${safeTitle}"`,
    `created: ${created}`,
    `category: "${opts.category || '工作总结'}"`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    `source: "工作流程跟踪工作台"`,
    `generated_at: "${now.toISOString()}"`,
    '---',
    ''
  ].join('\n');

  try {
    fs.writeFileSync(full, frontmatter + opts.contentMd + '\n', 'utf-8');
    cache = null; // 失效缓存
    return { ok: true, path: path.relative(root, full).split(path.sep).join('/'), message: '写入成功' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: /EACCES|EPERM|EROFS/.test(msg)
        ? `写入失败：目录为只读权限（${msg}）。如需写回，请把 vault 挂载由 :ro 改为 :rw`
        : `写入失败：${msg}`
    };
  }
}

/** 目录树概览，供前端浏览 */
export function vaultTree(limit = 200) {
  const notes = listNotes();
  const folders = new Map<string, number>();
  for (const n of notes) {
    const key = n.folder || '(根目录)';
    folders.set(key, (folders.get(key) || 0) + 1);
  }
  return {
    total: notes.length,
    folders: [...folders.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50),
    recent: notes.slice(0, limit)
  };
}
