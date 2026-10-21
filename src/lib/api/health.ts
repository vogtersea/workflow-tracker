import { getDb } from '@/lib/db-registry';
import { ok } from './http';
import { guard } from './guard';

/**
 * 健康检查接口（同构）
 *
 * 与其它接口不同，健康检查天然依赖「本机」信息：数据库文件在哪、文件多大、
 * Node 版本与运行时长。这些在浏览器里都不存在，因此统一由调用方通过 meta 注入，
 * 本文件只保留与数据库查询、响应结构相关的逻辑，自身不 import node:fs / process。
 */

export interface HealthMeta {
  /** 数据库文件绝对路径（服务端由 db.ts 的 dbPath() 提供） */
  dbPath: string;
  /** 读取文件字节数；文件不存在或不可读时返回 0（服务端注入 node:fs 实现） */
  fileSize: (path: string) => number;
  /** 运行时信息：Node 端传 process.version / process.uptime()，浏览器端传 'web' / 0 */
  runtime: { node: string; uptime: number };
}

/** 健康检查 — 供 Docker healthcheck 使用 */
export function healthGet(meta: HealthMeta): Promise<Response> {
  return guard(async () => {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    // WAL 模式下新写入的数据先落在 -wal 文件里，只统计主库会严重低估实际占用
    const dbFile = meta.dbPath;
    const size = meta.fileSize(dbFile);
    const walSize = meta.fileSize(`${dbFile}-wal`);
    return ok({
      status: 'healthy',
      db: dbFile,
      dbSize: size,
      walSize,
      totalSize: size + walSize,
      users: row.c,
      node: meta.runtime.node,
      uptime: Math.round(meta.runtime.uptime),
      time: new Date().toISOString()
    });
  });
}
