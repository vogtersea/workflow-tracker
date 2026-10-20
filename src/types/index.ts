/** 全局类型定义 */

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface CurrentUser {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
}

export interface TagDto {
  id: number;
  name: string;
  color: string;
}

export interface TaskDto {
  id: number;
  title: string;
  detail: string;
  done_criteria: string;
  due_date: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'done' | 'archived';
  owner_id: number | null;
  owner_name?: string | null;
  template_id: number | null;
  period_label: string | null;
  week_start: string | null;
  done_at: string | null;
  archived_at: string | null;
  estimate_hours: number | null;
  actual_hours: number | null;
  created_at: string;
  updated_at: string;
  tags: TagDto[];
  progress_count?: number;
  last_progress_at?: string | null;
  last_progress?: string | null;
}

export interface ProgressDto {
  id: number;
  content: string;
  percent: number | null;
  user_id: number | null;
  user_name?: string | null;
  created_at: string;
}

export type CadenceDto = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export interface TemplateDto {
  id: number;
  title: string;
  detail: string;
  done_criteria: string;
  cadence: CadenceDto;
  weekday: number | null;
  month_day: number | null;
  month_no: number | null;
  due_offset: number;
  priority: string;
  owner_id: number | null;
  owner_name?: string | null;
  tag_ids: string;
  enabled: number;
  last_run_period: string | null;
  created_at: string;
  /** 当前周期标识，如 2026-10 / 2026-Q4 / 2026-H2 */
  current_period: string;
  /** 当前周期中文名 */
  current_label: string;
  /** 当前周期实例到期日 */
  period_due: string;
  /** 当前周期实例状态，none 表示尚未生成 */
  period_status: 'none' | 'open' | 'done' | 'archived';
  /** 生成规则自然语言描述 */
  rule_text: string;
}

export interface ReportDto {
  id: number;
  scope: string;
  title: string;
  range_start: string | null;
  range_end: string | null;
  content_md: string;
  model: string | null;
  status: string;
  created_at: string;
  author?: string | null;
}
