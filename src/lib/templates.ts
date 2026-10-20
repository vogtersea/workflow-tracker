import { getDb } from './db';
import { isoWeek, ymd, today, monthRange } from './date';
import { createTask } from './tasks';

/**
 * 周期工作模板 → 自动生成实例
 *
 * 设计要点：
 *  - 模板保存 cadence（weekly/monthly）、触发日、到期偏移
 *  - 每个周期生成一次，用 last_run_period 记录已生成周期，幂等防重
 *  - 生成时机：应用启动时 + 每次访问工作列表时惰性触发，无需常驻定时器
 */

export interface TemplateRow {
  id: number;
  title: string;
  detail: string;
  done_criteria: string;
  cadence: 'weekly' | 'monthly';
  weekday: number | null;
  month_day: number | null;
  due_offset: number;
  priority: string;
  owner_id: number | null;
  tag_ids: string;
  enabled: number;
  last_run_period: string | null;
}

/** 计算模板在当前周期应生成的到期日 */
function computeDue(tpl: TemplateRow, now: Date): { due: string; period: string } | null {
  if (tpl.cadence === 'weekly') {
    const w = isoWeek(now);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - day);

    const targetWeekday = tpl.weekday ?? 5; // 默认周五
    const base = new Date(monday);
    base.setDate(monday.getDate() + (targetWeekday - 1));
    base.setDate(base.getDate() + (tpl.due_offset || 0));

    return { due: ymd(base), period: w.label };
  }

  const m = monthRange(now);
  const targetDay = Math.min(tpl.month_day ?? 25, 28);
  const base = new Date(now.getFullYear(), now.getMonth(), targetDay);
  base.setDate(base.getDate() + (tpl.due_offset || 0));
  return { due: ymd(base), period: m.start.slice(0, 7) };
}

/**
 * 生成到期实例
 * 仅当"当前周期尚未生成"且"到期日已进入提醒窗口（提前 7 天）或已到"时生成，
 * 避免提前生成过多未来工作干扰待办列表。
 */
export function generateFromTemplates(): { generated: number; details: string[] } {
  const db = getDb();
  const templates = db
    .prepare('SELECT * FROM task_templates WHERE enabled = 1')
    .all() as TemplateRow[];

  const now = new Date();
  const t = today();
  const details: string[] = [];
  let generated = 0;

  for (const tpl of templates) {
    const calc = computeDue(tpl, now);
    if (!calc) continue;

    // 该周期已生成过则跳过
    if (tpl.last_run_period === calc.period) continue;

    // 到期日超过 7 天后才生成，避免待办列表被未来工作刷屏
    const dueDate = new Date(calc.due);
    const leadDays = Math.round((dueDate.getTime() - t.getTime()) / 86400000);
    if (leadDays > 7) continue;

    // 防重：同模板同周期已存在实例
    const exists = db
      .prepare('SELECT id FROM tasks WHERE template_id = ? AND period_label = ?')
      .get(tpl.id, calc.period) as { id: number } | undefined;
    if (exists) {
      db.prepare('UPDATE task_templates SET last_run_period = ? WHERE id = ?').run(calc.period, tpl.id);
      continue;
    }

    let tagIds: number[] = [];
    try {
      tagIds = JSON.parse(tpl.tag_ids || '[]');
    } catch {
      tagIds = [];
    }

    createTask({
      title: tpl.title,
      detail: tpl.detail,
      done_criteria: tpl.done_criteria,
      due_date: calc.due,
      priority: tpl.priority,
      owner_id: tpl.owner_id,
      tag_ids: tagIds,
      template_id: tpl.id,
      period_label: calc.period
    });

    db.prepare('UPDATE task_templates SET last_run_period = ? WHERE id = ?').run(calc.period, tpl.id);
    generated++;
    details.push(`${tpl.title}（${calc.period}，到期 ${calc.due}）`);
  }

  return { generated, details };
}

export function listTemplates(): (TemplateRow & { owner_name?: string | null })[] {
  return getDb()
    .prepare(
      `SELECT tp.*, u.display_name AS owner_name
       FROM task_templates tp LEFT JOIN users u ON u.id = tp.owner_id
       ORDER BY tp.enabled DESC, tp.id DESC`
    )
    .all() as (TemplateRow & { owner_name?: string | null })[];
}

export function createTemplate(data: {
  title: string;
  detail?: string;
  done_criteria?: string;
  cadence: 'weekly' | 'monthly';
  weekday?: number | null;
  month_day?: number | null;
  due_offset?: number;
  priority?: string;
  owner_id?: number | null;
  tag_ids?: number[];
}): number {
  const info = getDb()
    .prepare(
      `INSERT INTO task_templates
       (title, detail, done_criteria, cadence, weekday, month_day, due_offset, priority, owner_id, tag_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.title.trim(),
      data.detail ?? '',
      data.done_criteria ?? '',
      data.cadence,
      data.weekday ?? null,
      data.month_day ?? null,
      data.due_offset ?? 0,
      data.priority || 'normal',
      data.owner_id ?? null,
      JSON.stringify(data.tag_ids ?? [])
    );
  return Number(info.lastInsertRowid);
}

export function updateTemplate(id: number, data: Record<string, unknown>) {
  const allowed = [
    'title',
    'detail',
    'done_criteria',
    'cadence',
    'weekday',
    'month_day',
    'due_offset',
    'priority',
    'owner_id',
    'enabled'
  ];
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (k in data && data[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(data[k]);
    }
  }
  if ('tag_ids' in data && Array.isArray(data.tag_ids)) {
    fields.push('tag_ids = ?');
    params.push(JSON.stringify(data.tag_ids));
  }
  if (!fields.length) return;
  params.push(id);
  getDb().prepare(`UPDATE task_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteTemplate(id: number) {
  getDb().prepare('DELETE FROM task_templates WHERE id = ?').run(id);
}
