import { getDb } from './db';
import { isoWeek, ymd, parseYmd } from './date';
import type { TaskRow } from './tasks';

/**
 * 周视图聚合
 *
 * 心智模型：「这周干了什么」——以周为单位盘点工作，而非以日为单位的日历。
 * 每周分四个桶：
 *   - done：本周完成（done_at 落在本周）
 *   - due：本周到期（含逾期未完成）
 *   - progress：本周有推进记录
 *   - open：本周尚无进展、且未到期的在办工作
 */

export interface WeekBucket {
  weekStart: string;
  weekEnd: string;
  label: string;
  year: number;
  week: number;
  done: TaskRow[];
  due: TaskRow[];
  progress: TaskRow[];
  open: TaskRow[];
  stats: {
    total: number;
    done: number;
    due: number;
    overdue: number;
    progress: number;
    open: number;
    completionRate: number;
  };
}

export interface WeekTrendPoint {
  weekStart: string;
  weekEnd: string;
  label: string;
  done: number;
  due: number;
  total: number;
}

/** 取本周一 */
export function currentWeekStart(d: Date = new Date()): string {
  return isoWeek(d).start;
}

/** 按周偏移取周首日，offset=0 本周，-1 上周，1 下周 */
export function weekStartByOffset(offset: number, from: Date = new Date()): string {
  const base = parseYmd(currentWeekStart(from));
  base.setDate(base.getDate() + offset * 7);
  return ymd(base);
}

/** 单周聚合 */
export function weekBucket(
  weekStart: string,
  opts?: { restrictToOwner?: number; ownerId?: number | null; limit?: number }
): WeekBucket {
  const db = getDb();
  const start = parseYmd(weekStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const weekEnd = ymd(end);
  const w = isoWeek(start);
  const todayStr = ymd();

  const scope: string[] = [];
  const scopeArgs: unknown[] = [];
  if (opts?.restrictToOwner) {
    scope.push('t.owner_id = ?');
    scopeArgs.push(opts.restrictToOwner);
  } else if (opts?.ownerId != null) {
    scope.push('t.owner_id = ?');
    scopeArgs.push(opts.ownerId);
  }
  const scopeSql = scope.length ? ` AND ${scope.join(' AND ')}` : '';

  const SELECT = `
    SELECT t.*,
           u.display_name AS owner_name,
           pj.name AS project_name,
           pj.color AS project_color,
           (SELECT COUNT(*) FROM task_progress p WHERE p.task_id = t.id) AS progress_count,
           (SELECT p.created_at FROM task_progress p WHERE p.task_id = t.id ORDER BY p.id DESC LIMIT 1) AS last_progress_at,
           (SELECT p.content FROM task_progress p WHERE p.task_id = t.id ORDER BY p.id DESC LIMIT 1) AS last_progress
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_id
    LEFT JOIN projects pj ON pj.id = t.project_id
  `;

  // 本周完成的
  const done = db
    .prepare(
      `${SELECT}
       WHERE t.done_at IS NOT NULL AND date(t.done_at) BETWEEN ? AND ?${scopeSql}
       ORDER BY t.done_at ASC`
    )
    .all(weekStart, weekEnd, ...scopeArgs) as TaskRow[];

  // 本周到期的（不论状态，含逾期未完成）
  const due = db
    .prepare(
      `${SELECT}
       WHERE t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?${scopeSql}
       ORDER BY t.due_date ASC`
    )
    .all(weekStart, weekEnd, ...scopeArgs) as TaskRow[];

  // 本周有进展记录的
  const progressed = db
    .prepare(
      `${SELECT}
       WHERE EXISTS (SELECT 1 FROM task_progress p
                     WHERE p.task_id = t.id AND date(p.created_at) BETWEEN ? AND ?)${scopeSql}
       ORDER BY t.updated_at DESC`
    )
    .all(weekStart, weekEnd, ...scopeArgs) as TaskRow[];

  // 在办但本周无任何动静
  const open = db
    .prepare(
      `${SELECT}
       WHERE t.status = 'open'
         AND NOT EXISTS (SELECT 1 FROM task_progress p
                         WHERE p.task_id = t.id AND date(p.created_at) BETWEEN ? AND ?)
         AND (t.due_date IS NULL OR t.due_date > ?)${scopeSql}
       ORDER BY t.due_date IS NULL, t.due_date ASC`
    )
    .all(weekStart, weekEnd, weekEnd, ...scopeArgs) as TaskRow[];

  // 逾期未完成（DDL 已过、本周仍未销号）——单列出来警示
  const overdue = db
    .prepare(
      `${SELECT}
       WHERE t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date < ?${scopeSql}
       ORDER BY t.due_date ASC`
    )
    .all(todayStr, ...scopeArgs) as TaskRow[];

  // 涉及的全部工作（用于完成率分母）：本周完成 ∪ 本周到期 ∪ 本周有进展
  const touchedIds = new Set<number>();
  for (const t of [...done, ...due, ...progressed]) touchedIds.add(t.id);
  const total = touchedIds.size;
  const doneCount = new Set(done.map((t) => t.id)).size;

  return {
    weekStart,
    weekEnd,
    label: w.label,
    year: w.year,
    week: w.week,
    done,
    due,
    progress: progressed,
    open,
    stats: {
      total,
      done: doneCount,
      due: due.length,
      overdue: overdue.length,
      progress: progressed.length,
      open: open.length,
      completionRate: total ? Math.round((doneCount / total) * 100) : 0
    }
  };
}

/** 近 N 周趋势，用于周视图顶部的迷你柱状图 */
export function weekTrend(
  weeks: number,
  opts?: { restrictToOwner?: number; ownerId?: number | null }
): WeekTrendPoint[] {
  const db = getDb();
  const scope: string[] = [];
  const scopeArgs: unknown[] = [];
  if (opts?.restrictToOwner) {
    scope.push('t.owner_id = ?');
    scopeArgs.push(opts.restrictToOwner);
  } else if (opts?.ownerId != null) {
    scope.push('t.owner_id = ?');
    scopeArgs.push(opts.ownerId);
  }
  const scopeSql = scope.length ? ` AND ${scope.join(' AND ')}` : '';

  const current = parseYmd(currentWeekStart());
  const from = new Date(current);
  from.setDate(current.getDate() - (weeks - 1) * 7);
  const fromStr = ymd(from);
  // 上界须取本周日（当前周的周日），否则本周尚未到来的几天会被切掉，
  // 表现为「本周明明有到期工作，趋势柱却是 0」
  const currentEnd = new Date(current);
  currentEnd.setDate(current.getDate() + 6);
  const toStr = ymd(currentEnd);

  const rows = db
    .prepare(
      `SELECT t.due_date AS due_date, date(t.done_at) AS done_day
       FROM tasks t
       WHERE (
         (t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?)
         OR (t.done_at IS NOT NULL AND date(t.done_at) BETWEEN ? AND ?)
         OR EXISTS (SELECT 1 FROM task_progress p
                     WHERE p.task_id = t.id AND date(p.created_at) BETWEEN ? AND ?)
       )${scopeSql}`
    )
    .all(fromStr, toStr, fromStr, toStr, fromStr, toStr, ...scopeArgs) as {
    due_date: string | null;
    done_day: string | null;
  }[];

  const points: WeekTrendPoint[] = [];
  for (let i = 0; i < weeks; i++) {
    const s = new Date(from);
    s.setDate(from.getDate() + i * 7);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    const ss = ymd(s);
    const es = ymd(e);
    const w = isoWeek(s);

    let done = 0;
    let due = 0;
    for (const r of rows) {
      if (r.done_day && r.done_day >= ss && r.done_day <= es) done++;
      if (r.due_date && r.due_date >= ss && r.due_date <= es) due++;
    }
    points.push({ weekStart: ss, weekEnd: es, label: w.label, done, due, total: done + due });
  }
  return points;
}
