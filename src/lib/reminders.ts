import { getDb, getSetting, setSetting } from './db';
import { today, ymd, diffDays, ddlHint } from './date';

/**
 * 提醒系统
 * - 站内通知：扫描待办生成 notifications 记录，带 dedupe_key 防重复
 * - Webhook 推送：POST JSON 到配置的 URL（支持企业微信/钉钉/飞书机器人格式）
 * - 浏览器桌面通知：前端轮询待办接口后由浏览器自行弹出
 */

export interface ReminderConfig {
  enabled: boolean;
  /** 提前多少天开始提醒，默认 3 */
  aheadDays: number;
  /** 每日推送时刻 HH:MM，默认 09:00 */
  time: string;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookType: 'generic' | 'wecom' | 'dingtalk' | 'feishu';
  webhookToken: string;
}

export function getReminderConfig(): ReminderConfig {
  return {
    enabled: getSetting('remind.enabled', '1') === '1',
    aheadDays: Number(getSetting('remind.aheadDays', '3')),
    time: getSetting('remind.time', '09:00'),
    webhookEnabled: getSetting('remind.webhookEnabled', '0') === '1',
    webhookUrl: getSetting('remind.webhookUrl', ''),
    webhookType: (getSetting('remind.webhookType', 'generic') as ReminderConfig['webhookType']) || 'generic',
    webhookToken: getSetting('remind.webhookToken', '')
  };
}

export interface ReminderItem {
  taskId: number;
  title: string;
  dueDate: string;
  kind: 'overdue' | 'due_soon' | 'today';
  level: 'danger' | 'warn';
  days: number;
  text: string;
  ownerId: number | null;
  ownerName?: string;
}

/** 扫描所有未完成且有 DDL 的工作，返回需要提醒的项 */
export function scanDueTasks(aheadDays?: number): ReminderItem[] {
  const cfg = getReminderConfig();
  const ahead = aheadDays ?? cfg.aheadDays;
  const t = today();
  const limitDate = new Date(t);
  limitDate.setDate(t.getDate() + ahead);

  const rows = getDb()
    .prepare(
      `SELECT t.id, t.title, t.due_date, t.owner_id, u.display_name AS owner_name
       FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date <= ?
       ORDER BY t.due_date ASC`
    )
    .all(ymd(limitDate)) as {
    id: number;
    title: string;
    due_date: string;
    owner_id: number | null;
    owner_name: string | null;
  }[];

  return rows.map((r) => {
    const d = diffDays(r.due_date)!;
    const kind: ReminderItem['kind'] = d < 0 ? 'overdue' : d === 0 ? 'today' : 'due_soon';
    return {
      taskId: r.id,
      title: r.title,
      dueDate: r.due_date,
      kind,
      level: d < 0 ? 'danger' : 'warn',
      days: d,
      text: ddlHint(r.due_date).text,
      ownerId: r.owner_id,
      ownerName: r.owner_name ?? undefined
    };
  });
}

/** 把待办写入站内通知（去重） */
export function syncNotifications(): { created: number; items: ReminderItem[] } {
  const cfg = getReminderConfig();
  if (!cfg.enabled) return { created: 0, items: [] };

  const db = getDb();
  const items = scanDueTasks();
  let created = 0;
  const todayStr = ymd(today());

  for (const item of items) {
    // 同一工作 + 同一状态（当天到期/逾期/临近）+ 同一日期，只提醒一次
    const dedupeKey = `task-${item.taskId}-${item.kind}-${todayStr}`;
    const title =
      item.kind === 'overdue'
        ? `工作已逾期：${item.title}`
        : item.kind === 'today'
          ? `今日到期：${item.title}`
          : `即将到期：${item.title}`;

    const info = db
      .prepare(
        `INSERT OR IGNORE INTO notifications (user_id, task_id, kind, level, title, body, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.ownerId,
        item.taskId,
        item.kind,
        item.level,
        title,
        `DDL：${item.dueDate}（${item.text}）`,
        dedupeKey
      );
    if (info.changes > 0) created++;
  }

  return { created, items };
}

/** 站内通知列表 */
export function listNotifications(userId: number, isAdmin: boolean, limit = 30) {
  const db = getDb();
  const rows = isAdmin
    ? db
        .prepare(
          `SELECT n.*, t.title AS task_title, u.display_name AS owner
           FROM notifications n
           LEFT JOIN tasks t ON t.id = n.task_id
           LEFT JOIN users u ON u.id = n.user_id
           ORDER BY n.id DESC LIMIT ?`
        )
        .all(limit)
    : db
        .prepare(
          `SELECT n.*, t.title AS task_title, u.display_name AS owner
           FROM notifications n
           LEFT JOIN tasks t ON t.id = n.task_id
           LEFT JOIN users u ON u.id = n.user_id
           WHERE n.user_id = ? OR n.user_id IS NULL
           ORDER BY n.id DESC LIMIT ?`
        )
        .all(userId, limit);
  return rows as {
    id: number;
    user_id: number | null;
    task_id: number | null;
    kind: string;
    level: string;
    title: string;
    body: string;
    seen: number;
    created_at: string;
    task_title: string | null;
    owner: string | null;
  }[];
}

export function unseenCount(userId: number, isAdmin: boolean): number {
  const db = getDb();
  const row = isAdmin
    ? (db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE seen = 0').get() as { c: number })
    : (db
        .prepare(
          'SELECT COUNT(*) AS c FROM notifications WHERE seen = 0 AND (user_id = ? OR user_id IS NULL)'
        )
        .get(userId) as { c: number });
  return row.c;
}

export function markSeen(ids: number[] | 'all', userId: number, isAdmin: boolean) {
  const db = getDb();
  if (ids === 'all') {
    if (isAdmin) db.prepare('UPDATE notifications SET seen = 1 WHERE seen = 0').run();
    else
      db.prepare('UPDATE notifications SET seen = 1 WHERE seen = 0 AND (user_id = ? OR user_id IS NULL)').run(
        userId
      );
    return;
  }
  const stmt = db.prepare('UPDATE notifications SET seen = 1 WHERE id = ?');
  for (const id of ids) stmt.run(id);
}

/** Webhook 推送 */
export async function pushWebhook(items: ReminderItem[]): Promise<{ ok: boolean; message: string }> {
  const cfg = getReminderConfig();
  if (!cfg.webhookEnabled) return { ok: false, message: 'Webhook 未启用' };
  if (!cfg.webhookUrl) return { ok: false, message: 'Webhook 地址未配置' };
  if (!items.length) return { ok: false, message: '无待推送内容' };

  const lines = items.map(
    (i) => `- ${i.kind === 'overdue' ? '【逾期】' : i.kind === 'today' ? '【今日】' : '【临近】'}${i.title}｜DDL ${i.dueDate}｜${i.text}`
  );
  const text = `工作流程提醒（${items.length} 项）\n${lines.join('\n')}`;

  let body: unknown;
  switch (cfg.webhookType) {
    case 'wecom':
      body = { msgtype: 'markdown', markdown: { content: text } };
      break;
    case 'dingtalk':
      body = { msgtype: 'markdown', markdown: { title: '工作流程提醒', text } };
      break;
    case 'feishu':
      body = { msg_type: 'text', content: { text } };
      break;
    default:
      body = { source: 'workflow-tracker', count: items.length, text, items };
  }

  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const respText = await res.text();
    return { ok: res.ok, message: res.ok ? '推送成功' : `HTTP ${res.status}：${respText.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export interface JobResult {
  skipped: boolean;
  reason?: string;
  scanned: number;
  created: number;
  pushed: boolean;
  pushMessage: string;
}

/**
 * 组合：扫描 + 入库 + 推送
 *
 * 幂等由两层保证：
 *   - 站内通知：notifications.dedupe_key 去重
 *   - 推送：settings.remind.lastRunDate 记录「今天已推过」，避免进程内定时器、
 *     边车 curl、手动触发同时打进来造成重复推送
 *
 * force=true 时跳过时间与日期判断（用于手工验证 Webhook 连通性）。
 */
export async function runReminderJob(opts: { force?: boolean } = {}): Promise<JobResult> {
  const cfg = getReminderConfig();
  if (!cfg.enabled && !opts.force) {
    return { skipped: true, reason: '提醒已关闭', scanned: 0, created: 0, pushed: false, pushMessage: '' };
  }

  const todayStr = ymd(today());

  if (!opts.force) {
    if (getSetting('remind.lastRunDate', '') === todayStr) {
      return { skipped: true, reason: '今日已执行', scanned: 0, created: 0, pushed: false, pushMessage: '' };
    }
    const now = new Date().toTimeString().slice(0, 5);
    if (now < (cfg.time || '09:00')) {
      return {
        skipped: true,
        reason: `未到提醒时刻 ${cfg.time || '09:00'}`,
        scanned: 0,
        created: 0,
        pushed: false,
        pushMessage: ''
      };
    }
  }

  const { created, items } = syncNotifications();
  let pushed = false;
  let pushMessage = '';

  if (cfg.webhookEnabled && items.length) {
    const r = await pushWebhook(items);
    pushed = r.ok;
    pushMessage = r.message;
  }

  // 无论推送成功与否都记日期：避免推送失败后每半小时重试刷屏
  if (!opts.force) setSetting('remind.lastRunDate', todayStr);

  return { skipped: false, scanned: items.length, created, pushed, pushMessage };
}
