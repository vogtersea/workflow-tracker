import { getDb } from './db';
import { isoWeek, ymd, today } from './date';

/** 工作项查询与写入的核心逻辑 */

export interface TaskTag {
  id: number;
  name: string;
  color: string;
}

export interface ProgressItem {
  id: number;
  content: string;
  percent: number | null;
  user_id: number | null;
  user_name?: string;
  created_at: string;
}

export interface TaskRow {
  id: number;
  title: string;
  detail: string;
  done_criteria: string;
  due_date: string | null;
  priority: string;
  status: string;
  owner_id: number | null;
  owner_name?: string;
  template_id: number | null;
  period_label: string | null;
  week_start: string | null;
  done_at: string | null;
  archived_at: string | null;
  estimate_hours: number | null;
  actual_hours: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  tags: TaskTag[];
  tags_text: string;
  progress_count?: number;
  last_progress_at?: string | null;
  last_progress?: string | null;
}

const BASE_SELECT = `
  SELECT t.*,
         u.display_name AS owner_name,
         (SELECT COUNT(*) FROM task_progress p WHERE p.task_id = t.id) AS progress_count,
         (SELECT p.created_at FROM task_progress p WHERE p.task_id = t.id ORDER BY p.id DESC LIMIT 1) AS last_progress_at,
         (SELECT p.content FROM task_progress p WHERE p.task_id = t.id ORDER BY p.id DESC LIMIT 1) AS last_progress
  FROM tasks t
  LEFT JOIN users u ON u.id = t.owner_id
`;

/** 批量装载标签，避免 N+1 */
function attachTags(rows: TaskRow[]): TaskRow[] {
  if (!rows.length) return rows;
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const links = db
    .prepare(
      `SELECT tt.task_id, tg.id, tg.name, tg.color
       FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
       WHERE tt.task_id IN (${placeholders})
       ORDER BY tg.name`
    )
    .all(...ids) as { task_id: number; id: number; name: string; color: string }[];

  const map = new Map<number, TaskTag[]>();
  for (const l of links) {
    const arr = map.get(l.task_id) || [];
    arr.push({ id: l.id, name: l.name, color: l.color });
    map.set(l.task_id, arr);
  }
  return rows.map((r) => {
    const tags = map.get(r.id) || [];
    return { ...r, tags, tags_text: tags.map((t) => t.name).join('、') };
  });
}

export interface QueryOptions {
  status?: 'open' | 'done' | 'archived' | 'all';
  ownerId?: number | null;
  /** 非管理员时强制只看本人 */
  restrictToOwner?: number;
  tagId?: number;
  keyword?: string;
  dueFrom?: string;
  dueTo?: string;
  rangeStart?: string;
  rangeEnd?: string;
  limit?: number;
  offset?: number;
  sort?: 'due' | 'created' | 'priority' | 'updated';
}

export function queryTasks(opts: QueryOptions = {}): { rows: TaskRow[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.status && opts.status !== 'all') {
    where.push('t.status = ?');
    params.push(opts.status);
  }
  if (opts.restrictToOwner) {
    where.push('t.owner_id = ?');
    params.push(opts.restrictToOwner);
  } else if (opts.ownerId != null) {
    where.push('t.owner_id = ?');
    params.push(opts.ownerId);
  }
  if (opts.tagId) {
    where.push('EXISTS (SELECT 1 FROM task_tags x WHERE x.task_id = t.id AND x.tag_id = ?)');
    params.push(opts.tagId);
  }
  if (opts.keyword) {
    where.push('(t.title LIKE ? OR t.detail LIKE ? OR t.done_criteria LIKE ?)');
    const k = `%${opts.keyword}%`;
    params.push(k, k, k);
  }
  // 按 DDL 区间
  if (opts.dueFrom) {
    where.push('t.due_date >= ?');
    params.push(opts.dueFrom);
  }
  if (opts.dueTo) {
    where.push('t.due_date <= ?');
    params.push(opts.dueTo);
  }
  // 按"活跃区间"过滤：DDL 落在区间内，或在该区间内有进展记录，或在该区间内完成
  if (opts.rangeStart && opts.rangeEnd) {
    where.push(`(
      (t.due_date BETWEEN ? AND ?)
      OR (t.done_at IS NOT NULL AND date(t.done_at) BETWEEN ? AND ?)
      OR (t.created_at IS NOT NULL AND date(t.created_at) BETWEEN ? AND ?)
      OR EXISTS (SELECT 1 FROM task_progress p WHERE p.task_id = t.id AND date(p.created_at) BETWEEN ? AND ?)
    )`);
    params.push(
      opts.rangeStart, opts.rangeEnd,
      opts.rangeStart, opts.rangeEnd,
      opts.rangeStart, opts.rangeEnd,
      opts.rangeStart, opts.rangeEnd
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortMap: Record<string, string> = {
    due: `CASE WHEN t.status != 'open' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date ASC, 
          CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
    created: 't.created_at DESC',
    updated: 't.updated_at DESC',
    priority: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.due_date ASC`
  };
  const orderSql = sortMap[opts.sort || 'due'] || sortMap.due;

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM tasks t ${whereSql}`).get(...params) as { c: number }
  ).c;

  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;

  const rows = db
    .prepare(`${BASE_SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as TaskRow[];

  return { rows: attachTags(rows), total };
}

export function getTask(id: number): (TaskRow & { progress: ProgressItem[] }) | null {
  const db = getDb();
  const row = db.prepare(`${BASE_SELECT} WHERE t.id = ?`).get(id) as TaskRow | undefined;
  if (!row) return null;
  const [withTags] = attachTags([row]);
  const progress = db
    .prepare(
      `SELECT p.*, u.display_name AS user_name
       FROM task_progress p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.task_id = ? ORDER BY p.id DESC`
    )
    .all(id) as ProgressItem[];
  return { ...withTags, progress };
}

export function setTaskTags(taskId: number, tagIds: number[]) {
  const db = getDb();
  db.tx(() => {
    db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
    const ins = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
    for (const tid of tagIds) ins.run(taskId, tid);
  });
}

export function createTask(data: {
  title: string;
  detail?: string;
  done_criteria?: string;
  due_date?: string | null;
  priority?: string;
  owner_id?: number | null;
  tag_ids?: number[];
  created_by?: number | null;
  template_id?: number | null;
  period_label?: string | null;
  estimate_hours?: number | null;
  status?: string;
}): number {
  const db = getDb();
  const week = data.due_date ? isoWeek(new Date(data.due_date)) : isoWeek();
  const weekStart = data.due_date ? isoWeek(new Date(data.due_date)).start : week.start;

  const info = db
    .prepare(
      `INSERT INTO tasks
       (title, detail, done_criteria, due_date, priority, status, owner_id, template_id,
        period_label, week_start, estimate_hours, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.title.trim(),
      data.detail ?? '',
      data.done_criteria ?? '',
      data.due_date || null,
      data.priority || 'normal',
      data.status || 'open',
      data.owner_id ?? null,
      data.template_id ?? null,
      data.period_label ?? null,
      weekStart,
      data.estimate_hours ?? null,
      data.created_by ?? null
    );

  const id = Number(info.lastInsertRowid);
  if (data.tag_ids?.length) setTaskTags(id, data.tag_ids);
  return id;
}

export function updateTask(
  id: number,
  data: Partial<{
    title: string;
    detail: string;
    done_criteria: string;
    due_date: string | null;
    priority: string;
    status: string;
    owner_id: number | null;
    estimate_hours: number | null;
    actual_hours: number | null;
    tag_ids: number[];
    sort_index: number;
  }>
) {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];

  const map: Record<string, string> = {
    title: 'title',
    detail: 'detail',
    done_criteria: 'done_criteria',
    due_date: 'due_date',
    priority: 'priority',
    status: 'status',
    owner_id: 'owner_id',
    estimate_hours: 'estimate_hours',
    actual_hours: 'actual_hours',
    sort_index: 'sort_index'
  };

  for (const [k, col] of Object.entries(map)) {
    if (k in data && data[k as keyof typeof data] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(data[k as keyof typeof data]);
    }
  }

  if ('due_date' in data) {
    const w = data.due_date ? isoWeek(new Date(data.due_date)).start : null;
    fields.push('week_start = ?');
    params.push(w);
  }

  // 状态联动：完成写 done_at，归档写 archived_at
  if (data.status === 'done') {
    fields.push(`done_at = COALESCE(done_at, datetime('now','localtime'))`);
  } else if (data.status === 'open') {
    fields.push('done_at = NULL', 'archived_at = NULL');
  } else if (data.status === 'archived') {
    fields.push('archived_at = datetime(\'now\',\'localtime\')');
  }

  fields.push(`updated_at = datetime('now','localtime')`);
  params.push(id);

  if (fields.length) db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  if (data.tag_ids) setTaskTags(id, data.tag_ids);
}

export function deleteTask(id: number) {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function addProgress(
  taskId: number,
  content: string,
  percent: number | null,
  userId: number | null
) {
  const db = getDb();
  db.prepare('INSERT INTO task_progress (task_id, content, percent, user_id) VALUES (?, ?, ?, ?)').run(
    taskId,
    content,
    percent,
    userId
  );
  db.prepare(`UPDATE tasks SET updated_at = datetime('now','localtime') WHERE id = ?`).run(taskId);
}

export function deleteProgress(id: number) {
  getDb().prepare('DELETE FROM task_progress WHERE id = ?').run(id);
}

// ---------- 标签 ----------
export function listTags() {
  return getDb()
    .prepare(
      `SELECT tg.*, (SELECT COUNT(*) FROM task_tags tt WHERE tt.tag_id = tg.id) AS usage_count
       FROM tags tg ORDER BY tg.name`
    )
    .all() as (TaskTag & { usage_count: number })[];
}

export function createTag(name: string, color = '#b91c1c') {
  const info = getDb()
    .prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)')
    .run(name.trim(), color);
  if (info.changes === 0) {
    const row = getDb().prepare('SELECT id FROM tags WHERE name = ?').get(name.trim()) as {
      id: number;
    };
    return row.id;
  }
  return Number(info.lastInsertRowid);
}

export function deleteTag(id: number) {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id);
}

// ---------- 统计 ----------
export function dashboardStats(ownerId?: number | null) {
  const db = getDb();
  const scope = ownerId ? 'AND owner_id = ?' : '';
  const scopeArgs = ownerId ? [ownerId] : [];
  const t = ymd(today());

  /** 按 SQL 中占位符出现的顺序拼接参数，避免顺序错位 */
  const q = (sql: string, leading: unknown[] = []) =>
    (db.prepare(sql).get(...leading, ...scopeArgs) as { c: number }).c;

  const open = q(`SELECT COUNT(*) AS c FROM tasks WHERE status = 'open' ${scope}`);
  const overdue = q(
    `SELECT COUNT(*) AS c FROM tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date < ? ${scope}`,
    [t]
  );
  const dueSoon = q(
    `SELECT COUNT(*) AS c FROM tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date >= ? AND due_date <= date(?, '+3 day') ${scope}`,
    [t, t]
  );
  const todayDue = q(`SELECT COUNT(*) AS c FROM tasks WHERE status = 'open' AND due_date = ? ${scope}`, [t]);
  const doneThisWeek = q(
    `SELECT COUNT(*) AS c FROM tasks WHERE status IN ('done','archived') AND done_at IS NOT NULL AND date(done_at) >= ? ${scope}`,
    [isoWeek().start]
  );
  const archived = q(`SELECT COUNT(*) AS c FROM tasks WHERE status = 'archived' ${scope}`);
  const noProgress = q(
    `SELECT COUNT(*) AS c FROM tasks t WHERE t.status = 'open' AND NOT EXISTS (SELECT 1 FROM task_progress p WHERE p.task_id = t.id) ${ownerId ? 'AND t.owner_id = ?' : ''}`
  );

  return { open, overdue, dueSoon, todayDue, doneThisWeek, archived, noProgress };
}

/** 聚合标签维度的完成情况，供报告使用 */
export function tagBreakdown(rangeStart: string, rangeEnd: string, ownerId?: number | null) {
  const scope = ownerId ? 'AND t.owner_id = ?' : '';
  const args: unknown[] = [rangeStart, rangeEnd, rangeStart, rangeEnd, rangeStart, rangeEnd];
  if (ownerId) args.push(ownerId);

  return getDb()
    .prepare(
      `SELECT tg.name,
              COUNT(DISTINCT CASE WHEN t.status IN ('done','archived') THEN t.id END) AS done,
              COUNT(DISTINCT t.id) AS total
       FROM tags tg
       JOIN task_tags tt ON tt.tag_id = tg.id
       JOIN tasks t ON t.id = tt.task_id
       WHERE (
         (t.due_date BETWEEN ? AND ?)
         OR (t.done_at IS NOT NULL AND date(t.done_at) BETWEEN ? AND ?)
         OR EXISTS (SELECT 1 FROM task_progress pp WHERE pp.task_id = t.id AND date(pp.created_at) BETWEEN ? AND ?)
       ) ${scope}
       GROUP BY tg.id ORDER BY total DESC`
    )
    .all(...args) as { name: string; done: number; total: number }[];
}
