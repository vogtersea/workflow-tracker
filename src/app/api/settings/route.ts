import { NextResponse } from 'next/server';
import { requireUser, requireAdmin, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { getSettings, setSetting, getSetting } from '@/lib/db';
import { getLlmConfig, saveLlmConfig, testLlm, listModels } from '@/lib/llm';
import { getReminderConfig } from '@/lib/reminders';
import { vaultEnabled, vaultDir, vaultDirSource, writebackSubdir } from '@/lib/obsidian';
import { dbPath, dataDir } from '@/lib/db';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

const KEYS = [
  'remind.enabled',
  'remind.aheadDays',
  'remind.time',
  'remind.webhookEnabled',
  'remind.webhookUrl',
  'remind.webhookType',
  'obsidian.vaultDir',
  'obsidian.writebackSubdir',
  'report.authorName',
  'report.orgName'
];

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode');

    if (mode === 'testLlm') {
      const r = await testLlm();
      return NextResponse.json({ ok: true, data: r });
    }
    if (mode === 'models') {
      const models = await listModels();
      return NextResponse.json({ ok: true, data: models });
    }

    const settings = getSettings(KEYS);
    const llm = getLlmConfig();
    const remind = getReminderConfig();

    // 数据文件大小
    let dbSize = 0;
    try {
      dbSize = fs.statSync(dbPath()).size;
    } catch {
      dbSize = 0;
    }

    return NextResponse.json({
      ok: true,
      data: {
        settings,
        llm: { ...llm, apiKey: llm.apiKey ? '••••••••' : '' },
        llmConfigured: Boolean(llm.baseUrl && llm.model),
        remind,
        obsidian: {
          enabled: vaultEnabled(),
          dir: vaultDir(),
          dirSource: vaultDirSource(),
          writeback: writebackSubdir(),
          // FTS5 探测结果：1 走索引，0 回退逐篇 LIKE，空表示尚未探测
          fts: getSetting('obsidian.fts', '')
        },
        system: {
          dbPath: dbPath(),
          dataDir: dataDir(),
          dbSize,
          nodeVersion: process.version,
          isAdmin: user.role === 'admin'
        }
      }
    });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: '查询失败' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();

    // 大模型配置
    if (body.section === 'llm') {
      const cfg = body.llm || {};
      // 前端回传掩码时保留原密钥
      if (cfg.apiKey && cfg.apiKey.includes('••')) {
        delete cfg.apiKey;
      }
      saveLlmConfig(cfg);
      return NextResponse.json({ ok: true });
    }

    // 提醒配置
    if (body.section === 'remind') {
      const r = body.remind || {};
      const map: Record<string, string> = {
        'remind.enabled': r.enabled ? '1' : '0',
        'remind.aheadDays': String(r.aheadDays ?? 3),
        'remind.time': /^\d{2}:\d{2}$/.test(String(r.time ?? '')) ? String(r.time) : '09:00',
        'remind.webhookEnabled': r.webhookEnabled ? '1' : '0',
        'remind.webhookUrl': r.webhookUrl ?? '',
        'remind.webhookType': r.webhookType ?? 'generic'
      };
      for (const [k, v] of Object.entries(map)) setSetting(k, v);
      return NextResponse.json({ ok: true });
    }

    // Obsidian 配置
    if (body.section === 'obsidian') {
      const o = body.obsidian || {};
      setSetting('obsidian.vaultDir', o.dir ?? '');
      setSetting('obsidian.writebackSubdir', o.writeback ?? '99-收件箱');
      return NextResponse.json({ ok: true });
    }

    // 报告落款信息
    if (body.section === 'report') {
      setSetting('report.authorName', body.authorName ?? '');
      setSetting('report.orgName', body.orgName ?? '');
      return NextResponse.json({ ok: true });
    }

    // 通用 key-value
    if (body.section === 'kv' && body.key) {
      if (!KEYS.includes(body.key))
        return NextResponse.json({ ok: false, error: '该配置项不允许修改' }, { status: 400 });
      setSetting(body.key, String(body.value ?? ''));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: '未知配置分区' }, { status: 400 });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    console.error('[settings POST]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '保存失败' },
      { status: 500 }
    );
  }
}
