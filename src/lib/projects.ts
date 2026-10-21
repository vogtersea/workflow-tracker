import { getDb } from './db-registry';

/**
 * 项目分组
 *
 * 与标签并存而非互相取代：
 *   - 标签：横向分类（材料撰写／汇报报送／日常事务），用于报告归纳
 *   - 项目：纵向归属（某项具体工作／某个条线），用于进度盘点
 * 同一项工作可同时挂一个项目与多个标签。
 */

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  color: string;
  status: 'active' | 'archived';
  created_at: string;
  /** 统计字段 */
  task_count?: number;
  open_count?: number;
  done_count?: number;
  overdue_count?: number;
  due_soon_count?: number;
  last_done_at?: string | null;
}

export function listProjects(opts?: { includeArchived?: boolean }): ProjectRow[] {
  const db = getDb();
  const where = opts?.includeArchived ? '' : "WHERE p.status = 'active'";
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'open') AS open_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('done','archived')) AS done_count,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.project_id = p.id AND t.status = 'open'
                  AND t.due_date IS NOT NULL AND t.due_date < date('now','localtime')) AS overdue_count,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.project_id = p.id AND t.status = 'open'
                  AND t.due_date IS NOT NULL AND t.due_date >= date('now','localtime')
                  AND t.due_date <= date('now','localtime','+3 day')) AS due_soon_count,
              (SELECT MAX(t.done_at) FROM tasks t WHERE t.project_id = p.id AND t.done_at IS NOT NULL) AS last_done_at
       FROM projects p
       ${where}
       ORDER BY p.status ASC, p.name ASC`
    )
    .all() as ProjectRow[];
}

export function getProject(id: number): ProjectRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'open') AS open_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('done','archived')) AS done_count
       FROM projects p WHERE p.id = ?`
    )
    .get(id) as ProjectRow | undefined;
}

export function createProject(data: {
  name: string;
  description?: string;
  color?: string;
}): number {
  const info = getDb()
    .prepare('INSERT INTO projects (name, description, color) VALUES (?, ?, ?)')
    .run(data.name.trim(), data.description ?? '', data.color || '#7f1d1d');
  return Number(info.lastInsertRowid);
}

export function updateProject(
  id: number,
  data: Partial<{ name: string; description: string; color: string; status: 'active' | 'archived' }>
) {
  const map: Record<string, string> = {
    name: 'name',
    description: 'description',
    color: 'color',
    status: 'status'
  };
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(map)) {
    if (data[k as keyof typeof data] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(data[k as keyof typeof data]);
    }
  }
  if (!fields.length) return;
  params.push(id);
  getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteProject(id: number) {
  // 工作本身不删除，仅解除归属（tasks.project_id 为 ON DELETE SET NULL）
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/** 项目名 → 颜色映射，供报告与列表着色 */
export function projectColorMap(): Record<string, string> {
  const rows = getDb().prepare('SELECT name, color FROM projects').all() as {
    name: string;
    color: string;
  }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.name] = r.color;
  return out;
}
