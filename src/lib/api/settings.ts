import { requireUserFrom, requireAdminFrom } from '@/lib/auth';
import { getSettings, setSetting, getSetting } from '@/lib/db-registry';
import { getLlmConfig, saveLlmConfig, testLlm, listModels, type LlmConfig } from '@/lib/llm';
import { getReminderConfig } from '@/lib/reminders';
import { ok, fail, json, readJson } from './http';
import { guard } from './guard';

/**
 * 系统设置接口（同构）
 *
 * 逻辑与原 route.ts 完全一致，只把 NextResponse 换成标准 Response。
 * 唯一区别：数据库路径、数据目录、库文件大小、Node 版本属于「部署环境信息」，
 * 由 route.ts 读取文件系统后通过 meta 注入，本文件因此不依赖 node:fs。
 */

export interface ObsidianMeta {
  vaultEnabled: () => boolean;
  vaultDir: () => string;
  vaultDirSource: () => string;
  writebackSubdir: () => string;
}

export interface SettingsMeta {
  dbPath: string;
  dataDir: string;
  dbSize: number;
  nodeVersion: string;
  /** Obsidian 相关探测依赖 node:fs，由服务端注入；手机端注入「不支持」实现 */
  obsidian: ObsidianMeta;
}

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

export function settingsGet(req: Request, meta: SettingsMeta): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode');

    if (mode === 'testLlm') {
      const r = await testLlm();
      return ok(r);
    }
    if (mode === 'models') {
      const models = await listModels();
      return ok(models);
    }

    const settings = getSettings(KEYS);
    const llm = getLlmConfig();
    const remind = getReminderConfig();

    return ok({
      settings,
      llm: { ...llm, apiKey: llm.apiKey ? '••••••••' : '' },
      llmConfigured: Boolean(llm.baseUrl && llm.model),
      remind,
      obsidian: {
        enabled: meta.obsidian.vaultEnabled(),
        dir: meta.obsidian.vaultDir(),
        dirSource: meta.obsidian.vaultDirSource(),
        writeback: meta.obsidian.writebackSubdir(),
        // FTS5 探测结果：1 走索引，0 回退逐篇 LIKE，空表示尚未探测
        fts: getSetting('obsidian.fts', '')
      },
      system: {
        dbPath: meta.dbPath,
        dataDir: meta.dataDir,
        dbSize: meta.dbSize,
        nodeVersion: meta.nodeVersion,
        isAdmin: user.role === 'admin'
      }
    });
  });
}

interface SettingsPostBody {
  section?: string;
  llm?: Partial<LlmConfig>;
  remind?: {
    enabled?: boolean;
    aheadDays?: number | string;
    time?: string;
    webhookEnabled?: boolean;
    webhookUrl?: string;
    webhookType?: string;
  };
  obsidian?: { dir?: string; writeback?: string };
  authorName?: string;
  orgName?: string;
  key?: string;
  value?: unknown;
}

export function settingsPost(req: Request): Promise<Response> {
  return guard(async () => {
    requireAdminFrom(req);
    const body = await readJson<SettingsPostBody>(req);

    // 大模型配置
    if (body.section === 'llm') {
      const cfg: Partial<LlmConfig> = body.llm || {};
      // 前端回传掩码时保留原密钥
      if (cfg.apiKey && cfg.apiKey.includes('••')) {
        delete cfg.apiKey;
      }
      saveLlmConfig(cfg);
      return json({ ok: true });
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
      return json({ ok: true });
    }

    // Obsidian 配置
    if (body.section === 'obsidian') {
      const o = body.obsidian || {};
      setSetting('obsidian.vaultDir', o.dir ?? '');
      setSetting('obsidian.writebackSubdir', o.writeback ?? '99-收件箱');
      return json({ ok: true });
    }

    // 报告落款信息
    if (body.section === 'report') {
      setSetting('report.authorName', body.authorName ?? '');
      setSetting('report.orgName', body.orgName ?? '');
      return json({ ok: true });
    }

    // 通用 key-value
    if (body.section === 'kv' && body.key) {
      if (!KEYS.includes(body.key)) return fail('该配置项不允许修改', 400);
      setSetting(body.key, String(body.value ?? ''));
      return json({ ok: true });
    }

    return fail('未知配置分区', 400);
  });
}
