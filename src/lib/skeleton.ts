import { getDb } from './db-registry';
import { cnDate, ddlHint, PRIORITY_LABEL, STATUS_LABEL, diffDays } from './date';
import type { TaskRow } from './tasks';

/**
 * 骨架渲染（降级模式）
 *
 * 用途：未配置大模型或大模型调用失败时，不让用户「卡住在一个红叉上」，
 * 而是用系统已有的确定性事实直接排成一份结构完整的报告骨架。
 *
 * 铁律与模型路径完全一致：
 *   - 只输出数据库里真实存在的数据，不作任何推断与评价
 *   - 凡是材料不足以支撑的论断，一律留空并标注「待补充」
 *   - 骨架是「填好数据的空文」，不是「编好的文章」
 */

export interface SkeletonMeta {
  /** 生成时间 */
  generatedAt: string;
  /** 区间 */
  rangeStart: string;
  rangeEnd: string;
}

/** 序号转中文数字（一、二、三…），用于二级标题的连续编号 */
function cn(n: number): string {
  const nums = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return nums[n];
  if (n < 20) return `十${n % 10 ? nums[n % 10] : ''}`;
  return `${nums[Math.floor(n / 10)]}十${n % 10 ? nums[n % 10] : ''}`;
}

/** 单项工作骨架 */
export function singleSkeleton(
  task: TaskRow,
  progress: { content: string; percent: number | null; created_at: string; display_name: string | null }[]
): string {
  const dueInfo = task.due_date
    ? `${task.due_date}（${ddlHint(task.due_date).text}）${task.done_at ? `，实际完成于 ${task.done_at.slice(0, 10)}` : ''}`
    : '未设置';

  const lines: string[] = [];

  lines.push('一、工作概况');
  lines.push('');
  lines.push(`本项工作的名称为「${task.title}」，当前状态为${STATUS_LABEL[task.status] ?? task.status}，优先级为${PRIORITY_LABEL[task.priority] ?? task.priority}，责任人为${task.owner_name || '未指定'}。`);
  lines.push('');
  lines.push(`工作目标与完成条件：${task.done_criteria || '（未填写完成条件，待补充）'}`);
  lines.push('');
  lines.push(`时间要求：${dueInfo}`);
  if (task.estimate_hours != null) lines.push(`预估工时：${task.estimate_hours} 小时。`);
  if (task.project_name) lines.push(`所属项目：${task.project_name}。`);
  if (task.tags?.length) lines.push(`分类标签：${task.tags.map((t) => t.name).join('、')}。`);
  lines.push('');
  lines.push('> 成果评价待补充（本骨架不自动生成成效性表述）。');

  lines.push('');
  lines.push('二、推进过程');
  lines.push('');
  if (progress.length) {
    lines.push('按照进展记录时间顺序梳理如下：');
    lines.push('');
    progress.forEach((p, i) => {
      const who = p.display_name ? `${p.display_name}` : '经办人';
      const pct = p.percent != null ? `，进度${p.percent}%` : '';
      lines.push(`${i + 1}. ${p.created_at.slice(0, 16)}｜${who}${pct}：${p.content}`);
    });
  } else {
    lines.push('（暂无进展记录）');
    lines.push('');
    lines.push('> 推进过程待补充。');
  }

  lines.push('');
  lines.push('三、完成情况');
  lines.push('');
  const done = task.status === 'done' || task.status === 'archived';
  if (done) {
    lines.push(`本项工作已于 ${task.done_at ? task.done_at.slice(0, 10) : '（时间未记录）'} 完成销号，完成条件为「${task.done_criteria || '未填写'}」，当前完成情况与完成条件基本一致。`);
  } else {
    const d = diffDays(task.due_date);
    lines.push(
      `本项工作尚未销号，当前状态为${STATUS_LABEL[task.status] ?? task.status}${task.due_date ? `，距离 DDL（${task.due_date}）${d !== null && d < 0 ? `已逾期 ${-d} 天` : d === 0 ? '即为今日' : `还有 ${d} 天`}` : ''}。`
    );
    lines.push(`对照完成条件「${task.done_criteria || '未填写'}」，当前差距需由经办人补充说明。`);
  }

  lines.push('');
  lines.push('四、成效与经验');
  lines.push('');
  lines.push('> 待补充。系统仅提供客观事实，不自动生成成效性评价；请根据实际情况补充。');

  lines.push('');
  lines.push('五、下一步安排');
  lines.push('');
  if (done) {
    lines.push('本项工作已完成。后续如需固化经验、推广做法或纳入常态化机制，请补充相应安排。');
  } else {
    lines.push('请补充下一步工作安排，包括推进节点、责任人及需要协调的事项。');
  }

  return lines.join('\n');
}

/** 周期总结骨架 */
export function periodSkeleton(
  tasks: TaskRow[],
  meta: SkeletonMeta,
  extra?: { scopeName?: string; extraInstruction?: string }
): string {
  const total = tasks.length;
  const doneList = tasks.filter((t) => t.status === 'done' || t.status === 'archived');
  const openList = tasks.filter((t) => t.status === 'open');
  const overdueList = openList.filter((t) => t.due_date && diffDays(t.due_date)! < 0);
  const noProgress = openList.filter((t) => !(t.progress_count ?? 0));

  const doneCount = doneList.length;
  const rate = total ? Math.round((doneCount / total) * 100) : 0;

  // 项目维度
  const byProject = new Map<string, { total: number; done: number }>();
  // 标签维度
  const byTag = new Map<string, { total: number; done: number }>();
  for (const t of tasks) {
    const pKey = t.project_name || '未归入项目';
    const p = byProject.get(pKey) || { total: 0, done: 0 };
    p.total++;
    if (t.status === 'done' || t.status === 'archived') p.done++;
    byProject.set(pKey, p);

    for (const tag of t.tags || []) {
      const g = byTag.get(tag.name) || { total: 0, done: 0 };
      g.total++;
      if (t.status === 'done' || t.status === 'archived') g.done++;
      byTag.set(tag.name, g);
    }
  }

  const lines: string[] = [];
  const scopeName = extra?.scopeName || '工作总结';

  lines.push(`一、总体情况`);
  lines.push('');
  lines.push(
    `${cnDate(meta.rangeStart)}至${cnDate(meta.rangeEnd)}期间，纳入统计的工作共 ${total} 项，其中已完成 ${doneCount} 项，仍在推进 ${openList.length} 项，逾期未完成 ${overdueList.length} 项，完成率 ${rate}%。`
  );
  lines.push('');
  lines.push('> 本节为客观数据罗列，成果评价待补充。');

  lines.push('');
  lines.push('二、重点工作推进情况');
  lines.push('');
  if (byProject.size || byTag.size) {
    if (byProject.size) {
      lines.push('按项目归集情况如下：');
      lines.push('');
      for (const [name, s] of byProject) {
        lines.push(`- ${name}：共 ${s.total} 项，已完成 ${s.done} 项。`);
      }
      lines.push('');
    }
    if (byTag.size) {
      lines.push('按标签归集情况如下：');
      lines.push('');
      for (const [name, s] of byTag) {
        lines.push(`- ${name}：共 ${s.total} 项，已完成 ${s.done} 项。`);
      }
      lines.push('');
    }
  }
  lines.push('重点工作明细（按完成条件与 DDL 状态）：');
  lines.push('');
  for (const t of tasks) {
    const due = t.due_date ? `${t.due_date}（${ddlHint(t.due_date).text}）` : '未设 DDL';
    const owner = t.owner_name || '未指定';
    const proj = t.project_name ? `｜${t.project_name}` : '';
    lines.push(
      `- ${t.title}${proj}｜${STATUS_LABEL[t.status] ?? t.status}｜${PRIORITY_LABEL[t.priority] ?? t.priority}｜责任人 ${owner}｜DDL ${due}｜进展 ${t.progress_count ?? 0} 条`
    );
  }
  if (!tasks.length) lines.push('- 无工作记录');
  lines.push('');
  lines.push('> 各项工作的具体成效与经验待补充。');

  lines.push('');
  lines.push('三、存在问题与不足');
  lines.push('');
  let issueNo = 0;
  if (overdueList.length) {
    issueNo++;
    lines.push(`${cn(issueNo)}、逾期未完成事项：`);
    lines.push('');
    for (const t of overdueList) {
      lines.push(
        `- ${t.title}：DDL ${t.due_date}，已逾期 ${-diffDays(t.due_date)!} 天，进展 ${t.progress_count ?? 0} 条。`
      );
    }
    lines.push('');
  }
  if (noProgress.length) {
    issueNo++;
    lines.push(`${cn(issueNo)}、尚无进展记录的在办事项：`);
    lines.push('');
    for (const t of noProgress.slice(0, 30)) {
      const due = t.due_date ? `，DDL ${t.due_date}` : '';
      lines.push(`- ${t.title}${due}。`);
    }
    if (noProgress.length > 30) lines.push(`- （其余 ${noProgress.length - 30} 项略）`);
    lines.push('');
  }
  if (!issueNo) {
    lines.push('系统未发现逾期或长期无进展的事项。');
    lines.push('');
  }
  lines.push('> 主观层面的问题分析待补充。');

  lines.push('');
  lines.push('四、下一步工作打算');
  lines.push('');
  let planNo = 0;
  if (overdueList.length) {
    planNo++;
    lines.push(`${cn(planNo)}、针对逾期事项，逐项明确责任人与完成时限：`);
    lines.push('');
    for (const t of overdueList) {
      lines.push(`- ${t.title}（${t.owner_name || '责任人待定'}）：计划于 ____ 前完成。`);
    }
    lines.push('');
  }
  if (noProgress.length) {
    planNo++;
    lines.push(`${cn(planNo)}、针对无进展记录事项，明确启动时间与阶段性节点。`);
    lines.push('');
  }
  planNo++;
  lines.push(`${cn(planNo)}、其余工作安排待补充。`);
  if (extra?.extraInstruction) {
    lines.push('');
    lines.push(`> 附加要求（原文留存）：${extra.extraInstruction}`);
  }

  return lines.join('\n');
}
