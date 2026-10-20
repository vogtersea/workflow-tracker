import { getDb } from './db';
import { isoWeek, ymd, today, daysInMonth } from './date';
import { createTask } from './tasks';

/**
 * 例行固定工作（周期模板）→ 自动生成工作实例
 *
 * 设计要点：
 *  - 例行工作是「一直都有」的定期动作，按 天/周/月/季度/半年/年 六种周期重复
 *  - 每个周期生成一次，用 last_run_period 记录已生成周期，幂等防重
 *  - 生成时机：应用启动时 + 每次访问工作列表时惰性触发，无需常驻定时器
 *  - 不同周期给不同的提前窗口：周期越长提前越多，年度的提前 30 天就要出现在待办里
 */

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  quarterly: '每季度',
  halfyearly: '每半年',
  yearly: '每年'
};

/** 各周期进入待办的提前天数 */
export const CADENCE_LEAD: Record<Cadence, number> = {
  daily: 1,
  weekly: 7,
  monthly: 7,
  quarterly: 14,
  halfyearly: 21,
  yearly: 30
};

export interface TemplateRow {
  id: number;
  title: string;
  detail: string;
  done_criteria: string;
  cadence: Cadence;
  weekday: number | null;
  month_day: number | null;
  month_no: number | null;
  due_offset: number;
  priority: string;
  owner_id: number | null;
  tag_ids: string;
  enabled: number;
  last_run_period: string | null;
}

export interface TemplateView extends TemplateRow {
  owner_name?: string | null;
  /** 当前周期标识，如 2026-10 / 2026-Q4 / 2026-H2 / 2026 */
  current_period: string;
  /** 当前周期的中文描述 */
  current_label: string;
  /** 当前周期实例的到期日 */
  period_due: string;
  /** 当前周期实例状态；none 表示尚未生成 */
  period_status: 'none' | 'open' | 'done' | 'archived';
  /** 生成规则的自然语言描述 */
  rule_text: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 当前所在周期的标识与中文名 */
export function periodOf(cadence: Cadence, d: Date = new Date()): { period: string; label: string } {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0 起
  switch (cadence) {
    case 'daily':
      return { period: ymd(d), label: `${y}年${m + 1}月${d.getDate()}日` };
    case 'weekly': {
      const w = isoWeek(d);
      return { period: w.label, label: `${w.year}年第${w.week}周` };
    }
    case 'monthly':
      return { period: `${y}-${pad2(m + 1)}`, label: `${y}年${m + 1}月` };
    case 'quarterly': {
      const q = Math.floor(m / 3) + 1;
      return { period: `${y}-Q${q}`, label: `${y}年第${q}季度` };
    }
    case 'halfyearly': {
      const h = m < 6 ? 1 : 2;
      return { period: `${y}-H${h}`, label: `${y}年${h === 1 ? '上' : '下'}半年` };
    }
    case 'yearly':
      return { period: `${y}`, label: `${y}年` };
    default:
      return { period: `${y}-${pad2(m + 1)}`, label: `${y}年${m + 1}月` };
  }
}

/** 该周期到期日落在「年-月-日」，日超出当月天数时取月末 */
function dueInPeriod(tpl: TemplateRow, d: Date): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  const wantedDay = Math.min(Math.max(tpl.month_day ?? 28, 1), 31);

  let year = y;
  let month = m;

  switch (tpl.cadence) {
    case 'daily':
      return new Date(y, m, d.getDate());
    case 'weekly': {
      const monday = new Date(y, m, d.getDate());
      const offsetToMonday = (monday.getDay() + 6) % 7;
      monday.setDate(monday.getDate() - offsetToMonday);
      const target = new Date(monday);
      target.setDate(monday.getDate() + ((tpl.weekday ?? 5) - 1));
      return target;
    }
    case 'monthly':
      break;
    case 'quarterly':
      month = (Math.floor(m / 3) + 1) * 3 - 1;
      break;
    case 'halfyearly':
      month = m < 6 ? 5 : 11;
      break;
    case 'yearly':
      month = Math.min(Math.max((tpl.month_no ?? 12) - 1, 0), 11);
      year = y;
      break;
  }

  const day = Math.min(wantedDay, daysInMonth(year, month + 1));
  return new Date(year, month, day);
}

/** 按周期步进参考日期 */
function stepDate(d: Date, cadence: Cadence, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (cadence) {
    case 'daily':
      x.setDate(x.getDate() + n);
      break;
    case 'weekly':
      x.setDate(x.getDate() + 7 * n);
      break;
    case 'monthly':
      x.setMonth(x.getMonth() + n);
      break;
    case 'quarterly':
      x.setMonth(x.getMonth() + 3 * n);
      break;
    case 'halfyearly':
      x.setMonth(x.getMonth() + 6 * n);
      break;
    case 'yearly':
      x.setFullYear(x.getFullYear() + n);
      break;
  }
  return x;
}

/**
 * 计算模板在当前周期应生成的到期日与周期标识
 *
 * 若本周期到期日已经过去（例如 10 月才新建「每年 1 月 10 日」的例行工作），
 * 则顺延到下一个尚未到期的周期，避免一建出来就是一条逾期数百天的幽灵任务。
 * 长期运行的模板不受影响：到期前已在提前窗口内生成实例，此处不会跳过。
 */
export function computeDue(
  tpl: TemplateRow,
  now: Date = new Date()
): { due: string; period: string; label: string; lead: number } {
  const todayStr = ymd(now);
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let ref = new Date(anchor);
  let base = dueInPeriod(tpl, ref);
  base.setDate(base.getDate() + (tpl.due_offset || 0));

  let guard = 0;
  while (ymd(base) < todayStr && guard < 400) {
    ref = stepDate(ref, tpl.cadence, 1);
    base = dueInPeriod(tpl, ref);
    base.setDate(base.getDate() + (tpl.due_offset || 0));
    guard++;
  }

  const { period, label } = periodOf(tpl.cadence, ref);
  return { due: ymd(base), period, label, lead: CADENCE_LEAD[tpl.cadence] ?? 7 };
}

/** 生成规则的中文描述 */
export function ruleText(tpl: TemplateRow): string {
  const day = tpl.month_day ?? 28;
  const offset = tpl.due_offset ? `，顺延 ${tpl.due_offset} 天` : '';
  switch (tpl.cadence) {
    case 'daily':
      return `每天到期${offset}`;
    case 'weekly': {
      const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      return `每${names[(tpl.weekday ?? 5) - 1] || '周五'}到期${offset}`;
    }
    case 'monthly':
      return `每月 ${day} 日到期${offset}`;
    case 'quarterly':
      return `每季度末月（3/6/9/12 月）${day} 日到期${offset}`;
    case 'halfyearly':
      return `每半年末月（6/12 月）${day} 日到期${offset}`;
    case 'yearly':
      return `每年 ${tpl.month_no ?? 12} 月 ${day} 日到期${offset}`;
    default:
      return '—';
  }
}

/**
 * 生成到期实例
 * 默认仅在「到期日进入提前窗口」时生成，避免提前铺满未来工作；
 * 显式新建模板时用 force 立即生成本周期实例，让用户马上看到。
 */
export function generateFromTemplates(
  opts: { force?: boolean; templateId?: number } = {}
): { generated: number; details: string[] } {
  const db = getDb();
  const sql = opts.templateId
    ? 'SELECT * FROM task_templates WHERE enabled = 1 AND id = ?'
    : 'SELECT * FROM task_templates WHERE enabled = 1';
  const templates = (
    opts.templateId ? db.prepare(sql).all(opts.templateId) : db.prepare(sql).all()
  ) as TemplateRow[];

  const now = new Date();
  const t = today();
  const details: string[] = [];
  let generated = 0;

  for (const tpl of templates) {
    const calc = computeDue(tpl, now);

    // 该周期已生成过则跳过
    if (tpl.last_run_period === calc.period) continue;

    // 未到期且尚未进入提前窗口时跳过（force 除外）
    if (!opts.force) {
      const dueDate = new Date(calc.due);
      const leadDays = Math.round((dueDate.getTime() - t.getTime()) / 86400000);
      if (leadDays > calc.lead) continue;
    }

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
    details.push(`${tpl.title}（${calc.label}，到期 ${calc.due}）`);
  }

  return { generated, details };
}

/** 列出模板，并附带「本周期」的生成与完成状态 */
export function listTemplates(): TemplateView[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT tp.*, u.display_name AS owner_name
       FROM task_templates tp LEFT JOIN users u ON u.id = tp.owner_id
       ORDER BY tp.enabled DESC, tp.id DESC`
    )
    .all() as (TemplateRow & { owner_name?: string | null })[];

  const now = new Date();
  return rows.map((r) => {
    const calc = computeDue(r, now);
    const inst = db
      .prepare(
        'SELECT id, status FROM tasks WHERE template_id = ? AND period_label = ? ORDER BY id DESC LIMIT 1'
      )
      .get(r.id, calc.period) as { id: number; status: string } | undefined;
    return {
      ...r,
      current_period: calc.period,
      current_label: calc.label,
      period_due: calc.due,
      period_status: (inst?.status as TemplateView['period_status']) || 'none',
      rule_text: ruleText(r)
    };
  });
}

export function createTemplate(data: {
  title: string;
  detail?: string;
  done_criteria?: string;
  cadence: Cadence;
  weekday?: number | null;
  month_day?: number | null;
  month_no?: number | null;
  due_offset?: number;
  priority?: string;
  owner_id?: number | null;
  tag_ids?: number[];
}): number {
  const info = getDb()
    .prepare(
      `INSERT INTO task_templates
       (title, detail, done_criteria, cadence, weekday, month_day, month_no, due_offset,
        priority, owner_id, tag_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.title.trim(),
      data.detail ?? '',
      data.done_criteria ?? '',
      data.cadence,
      data.cadence === 'weekly' ? (data.weekday ?? 5) : null,
      data.cadence === 'daily' ? null : (data.month_day ?? 28),
      data.cadence === 'yearly' ? (data.month_no ?? 12) : null,
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
    'month_no',
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
  // 改了周期规则就重置上次生成标记，让新规则能立刻生效
  if ('cadence' in data || 'month_day' in data || 'month_no' in data || 'weekday' in data) {
    fields.push('last_run_period = NULL');
  }
  params.push(id);
  getDb().prepare(`UPDATE task_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteTemplate(id: number) {
  getDb().prepare('DELETE FROM task_templates WHERE id = ?').run(id);
}
