import { getDb } from './db';
import { queryTasks, tagBreakdown, type TaskRow } from './tasks';
import { chat, isLlmConfigured } from './llm';
import { cnDate, ddlHint, PRIORITY_LABEL, STATUS_LABEL, diffDays } from './date';

/**
 * 总结报告生成
 * 策略：
 *  1. 先做确定性统计（完成率、逾期、标签分布），作为"事实底座"
 *  2. 再把工作明细与进展记录压成结构化上下文交给模型
 *  3. 要求模型严格基于给定材料写作，不得虚构未出现的事实
 */

export type ReportScope = 'single' | 'week' | 'month' | 'half_year' | 'year' | 'custom';

export const SCOPE_LABEL: Record<ReportScope, string> = {
  single: '单项工作总结',
  week: '周工作总结',
  month: '月度工作总结',
  half_year: '半年工作总结',
  year: '年度工作总结',
  custom: '自定义区间总结'
};

/** 将任务明细序列化为紧凑文本，控制 token 量 */
function serializeTasks(tasks: TaskRow[], withProgress = true): string {
  const db = getDb();
  const lines: string[] = [];

  for (const t of tasks) {
    const tags = t.tags?.length ? `［${t.tags.map((x) => x.name).join('/')}］` : '';
    const owner = t.owner_name ? `｜责任人：${t.owner_name}` : '';
    const due = t.due_date ? `｜DDL：${t.due_date}` : '｜DDL：未设';
    const hint = t.due_date ? `（${ddlHint(t.due_date).text}）` : '';
    const status = `｜状态：${STATUS_LABEL[t.status] ?? t.status}`;
    const prio = `｜优先级：${PRIORITY_LABEL[t.priority] ?? t.priority}`;

    lines.push(`\n### ${t.title} ${tags}`);
    lines.push(`【元信息】${due}${hint}${status}${prio}${owner}`);

    if (t.detail?.trim()) lines.push(`【工作详情】${t.detail.trim()}`);
    if (t.done_criteria?.trim()) lines.push(`【完成条件】${t.done_criteria.trim()}`);

    if (withProgress) {
      const progress = db
        .prepare(
          `SELECT p.content, p.percent, p.created_at, u.display_name
           FROM task_progress p LEFT JOIN users u ON u.id = p.user_id
           WHERE p.task_id = ? ORDER BY p.id ASC`
        )
        .all(t.id) as { content: string; percent: number | null; created_at: string; display_name: string | null }[];

      if (progress.length) {
        lines.push(`【进展记录】共 ${progress.length} 条：`);
        for (const p of progress) {
          const who = p.display_name ? `（${p.display_name}）` : '';
          const pct = p.percent != null ? ` 进度${p.percent}%` : '';
          lines.push(`  - ${p.created_at.slice(0, 16)}${who}${pct}：${p.content}`);
        }
      } else {
        lines.push('【进展记录】暂无');
      }
    }
  }

  return lines.join('\n');
}

/** 确定性统计块 */
function buildStats(tasks: TaskRow[], rangeStart: string, rangeEnd: string): string {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'archived').length;
  const open = tasks.filter((t) => t.status === 'open').length;
  const overdue = tasks.filter(
    (t) => t.status === 'open' && t.due_date && diffDays(t.due_date)! < 0
  ).length;
  const rate = total ? Math.round((done / total) * 100) : 0;

  const tagRows = tagBreakdown(rangeStart, rangeEnd);
  const tagText = tagRows.length
    ? tagRows.map((r) => `${r.name}（${r.done}/${r.total}）`).join('、')
    : '无标签数据';

  const completed = tasks.filter((t) => t.status === 'done' || t.status === 'archived');
  const achieveText = completed.length
    ? completed
        .map((t) => {
          const when = t.done_at ? t.done_at.slice(0, 10) : '时间不详';
          return `- ${t.title}：${when} 完成${t.due_date ? (t.done_at && t.done_at.slice(0, 10) <= t.due_date ? '（按期）' : '（超期）') : ''}`;
        })
        .join('\n')
    : '- 无已完成事项';

  return `
【统计事实】（系统计算，请直接使用，不得改动数字）
- 统计区间：${rangeStart} 至 ${rangeEnd}
- 涉及工作总数：${total} 项
- 已完成：${done} 项
- 仍在推进：${open} 项
- 逾期未完成：${overdue} 项
- 完成率：${rate}%
- 标签分布（完成/总数）：${tagText}

【已完成事项及按期情况】
${achieveText}
`.trim();
}

const SYSTEM_PROMPT = `你是一名在大型金融机构从事办公室文字工作的资深文稿起草人，熟悉党政机关与国有大型银行的公文语体规范。

写作要求：
1. 语言风格：正式、庄重、简练，符合机关工作总结的语体。多用"扎实推进""稳步落实""有力有序"等规范表述，避免口语化、网络化表达，不使用感叹号和表情符号。
2. 结构规范：使用一、二、三级标题体系。一级标题为"一、"，二级标题为"（一）"，三级标题为"1."。
3. 事实纪律（最高优先级）：只能使用用户提供的【统计事实】与【工作明细】中出现的信息。严禁编造任何未出现的数据、时间、人名、机构名、文件名称。如材料不足以支撑某项论述，直接省略，不要用推测性内容填充。
4. 数字口径：所有统计数字必须与【统计事实】完全一致，不得自行加减或四舍五入改变。
5. 不虚构成效：不得凭空写出"获得领导肯定""取得显著成效"等未经材料支撑的评语；如需评价，应基于完成情况作客观判断。
6. 输出格式：纯 Markdown，从一级标题开始，不要用代码块包裹全文。`;

/** 单项工作深度总结 */
export async function generateSingleReport(
  taskId: number,
  opts?: { extraInstruction?: string }
): Promise<{ content: string; model: string }> {
  const db = getDb();
  const task = queryTasks({ status: 'all', limit: 1000 }).rows.find((t) => t.id === taskId);
  if (!task) throw new Error('工作不存在');

  const progress = db
    .prepare(
      `SELECT p.content, p.percent, p.created_at, u.display_name
       FROM task_progress p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.task_id = ? ORDER BY p.id ASC`
    )
    .all(taskId) as { content: string; percent: number | null; created_at: string; display_name: string | null }[];

  const st = { text: '' };
  const timeline = progress.length
    ? progress
        .map((p, i) => {
          const who = p.display_name ? `${p.display_name}` : '经办人';
          const pct = p.percent != null ? `，进度${p.percent}%` : '';
          return `${i + 1}. ${p.created_at.slice(0, 16)}｜${who}${pct}：${p.content}`;
        })
        .join('\n')
    : '（无进展记录）';

  const dueInfo = task.due_date
    ? `${task.due_date}${task.done_at ? `，实际完成于 ${task.done_at.slice(0, 10)}` : `（${ddlHint(task.due_date).text}）`}`
    : '未设置';

  const userPrompt = `请根据以下材料，撰写一份单项工作总结报告。

【工作名称】${task.title}
【工作详情】${task.detail || '（未填写）'}
【完成条件】${task.done_criteria || '（未填写）'}
【DDL】${dueInfo}
【当前状态】${STATUS_LABEL[task.status] ?? task.status}
【优先级】${PRIORITY_LABEL[task.priority] ?? task.priority}
【责任部门/人】${task.owner_name || '未指定'}
【标签】${task.tags?.map((t) => t.name).join('、') || '无'}

【进展过程】（按时间顺序，共 ${progress.length} 条）
${timeline}

${opts?.extraInstruction ? `【额外要求】${opts.extraInstruction}\n` : ''}
请按以下结构输出：
一、工作概况（说明任务来源、目标、完成条件与时间要求）
二、推进过程（按时间脉络梳理关键节点与所做工作，须严格依据进展记录）
三、完成情况（对照完成条件逐项说明，已完成则写明结果，未完成则说明当前进度与差距）
四、成效与经验（基于材料客观提炼，材料不足以支撑的不要写）
五、下一步安排或需要说明的事项（如已全部完成，可写经验固化与后续改进方向）

篇幅控制在 800 至 1200 字。材料中的信息如不足以支撑某一章节，可精简该章节，但不得编造内容。`;

  const { text } = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);

  const cfg = db.prepare("SELECT value FROM settings WHERE key = 'llm.model'").get() as
    | { value: string }
    | undefined;

  return { content: text, model: cfg?.value || '' };
}

/** 周期工作总结 */
export async function generatePeriodReport(
  scope: ReportScope,
  rangeStart: string,
  rangeEnd: string,
  opts?: { ownerId?: number | null; extraInstruction?: string; title?: string }
): Promise<{ content: string; model: string; taskCount: number }> {
  const { rows: tasks } = queryTasks({
    status: 'all',
    rangeStart,
    rangeEnd,
    ownerId: opts?.ownerId ?? undefined,
    limit: 500,
    sort: 'due'
  });

  if (!tasks.length) {
    throw new Error('所选区间内没有工作记录，无法生成报告');
  }

  const stats = buildStats(tasks, rangeStart, rangeEnd);
  const detail = serializeTasks(tasks, true);

  const scopeName = SCOPE_LABEL[scope] || '工作总结';
  const periodText =
    scope === 'week'
      ? `本周（${cnDate(rangeStart)}至${cnDate(rangeEnd)}）`
      : `${cnDate(rangeStart)}至${cnDate(rangeEnd)}`;

  const userPrompt = `请根据以下材料，撰写一份${scopeName}。

${stats}

【工作明细】${detail}

${opts?.extraInstruction ? `【额外要求】${opts.extraInstruction}\n` : ''}
请按以下结构输出：
一、总体情况（说明本${scope === 'year' ? '年度' : scope === 'half_year' ? '半年' : scope === 'month' ? '月' : scope === 'week' ? '周' : '期'}期工作总体推进情况，引用统计事实中的数量与完成率）
二、重点工作推进情况（按标签或工作类别归纳，选取有实质进展的工作展开，突出完成条件达成情况与关键节点）
三、存在问题与不足（基于逾期未完成事项、无进展记录事项客观归纳，不得空泛套话）
四、下一步工作打算（针对问题提出具体举措，与存在问题一一对应）

篇幅控制在 1200 至 1800 字。${periodText}。
注意：不得编造材料中未出现的工作内容、数据或评价。`;

  const { text } = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);

  const cfg = getDb().prepare("SELECT value FROM settings WHERE key = 'llm.model'").get() as
    | { value: string }
    | undefined;

  return { content: text, model: cfg?.value || '', taskCount: tasks.length };
}

/** 保存报告 */
export function saveReport(data: {
  scope: string;
  title: string;
  rangeStart?: string;
  rangeEnd?: string;
  taskIds?: number[];
  contentMd: string;
  model?: string;
  createdBy?: number | null;
}): number {
  const info = getDb()
    .prepare(
      `INSERT INTO reports (scope, title, range_start, range_end, task_ids, content_md, model, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'done', ?)`
    )
    .run(
      data.scope,
      data.title,
      data.rangeStart ?? null,
      data.rangeEnd ?? null,
      JSON.stringify(data.taskIds ?? []),
      data.contentMd,
      data.model ?? null,
      data.createdBy ?? null
    );
  return Number(info.lastInsertRowid);
}

export function listReports(limit = 50) {
  return getDb()
    .prepare(
      `SELECT r.*, u.display_name AS author
       FROM reports r LEFT JOIN users u ON u.id = r.created_by
       ORDER BY r.id DESC LIMIT ?`
    )
    .all(limit);
}

export function getReport(id: number) {
  return getDb()
    .prepare(
      `SELECT r.*, u.display_name AS author
       FROM reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?`
    )
    .get(id);
}

export function deleteReport(id: number) {
  getDb().prepare('DELETE FROM reports WHERE id = ?').run(id);
}

export { isLlmConfigured };
