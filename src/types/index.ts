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

export interface TemplateDto {
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
  owner_name?: string | null;
  tag_ids: string;
  enabled: number;
  last_run_period: string | null;
  created_at: string;
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
