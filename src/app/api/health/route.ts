import { NextResponse } from 'next/server';
import { getDb, dbPath } from '@/lib/db';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

/** 健康检查 — 供 Docker healthcheck 使用 */
export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    let size = 0;
    try {
      size = fs.statSync(dbPath()).size;
    } catch {
      size = 0;
    }
    return NextResponse.json({
      ok: true,
      data: {
        status: 'healthy',
        db: dbPath(),
        dbSize: size,
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
