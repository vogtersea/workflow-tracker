import { NextResponse } from 'next/server';
import { getDb, dbPath } from '@/lib/db';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

/** 健康检查 — 供 Docker healthcheck 使用 */
export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    // WAL 模式下新写入的数据先落在 -wal 文件里，只统计主库会严重低估实际占用
    const dbFile = dbPath();
    let size = 0;
    let walSize = 0;
    try {
      size = fs.statSync(dbFile).size;
    } catch {
      size = 0;
    }
    try {
      walSize = fs.statSync(`${dbFile}-wal`).size;
    } catch {
      walSize = 0;
    }
    return NextResponse.json({
      ok: true,
      data: {
        status: 'healthy',
        db: dbFile,
        dbSize: size,
        walSize,
        totalSize: size + walSize,
        users: row.c,
        node: process.version,
        uptime: Math.round(process.uptime()),
        time: new Date().toISOString()
      }
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unhealthy' },
      { status: 503 }
    );
  }
}
