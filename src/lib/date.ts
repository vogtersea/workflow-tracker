/** 日期工具 — 统一以本地时区的 YYYY-MM-DD 作为业务日期口径 */

export function ymd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** 相差天数：正数表示未来，负数表示已过 */
export function diffDays(target: string | null | undefined, base: Date = today()): number | null {
  if (!target) return null;
  const t = parseYmd(target).getTime();
  return Math.round((t - base.getTime()) / 86400000);
}

/** ISO 周：返回 { year, week, start, end, label }，周一为一周起始 */
export function isoWeek(d: Date = new Date()) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // 周一=0
  const monday = new Date(date);
  monday.setDate(date.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return {
    year: thursday.getFullYear(),
    week,
    start: ymd(monday),
    end: ymd(sunday),
    label: `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`
  };
}

export function monthRange(d: Date = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: ymd(start), end: ymd(end), label: `${d.getFullYear()}年${d.getMonth() + 1}月` };
}

/** 指定年月的天数，month 从 1 开始 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 季度：1-4 */
export function quarterOf(d: Date = new Date()): number {
  return Math.floor(d.getMonth() / 3) + 1;
}

/** 半年：1=上半年，2=下半年 */
export function halfOf(d: Date = new Date()): number {
  return d.getMonth() < 6 ? 1 : 2;
}

export function yearRange(d: Date = new Date()) {
  return {
    start: ymd(new Date(d.getFullYear(), 0, 1)),
    end: ymd(new Date(d.getFullYear(), 11, 31)),
    label: `${d.getFullYear()}年`
  };
}

/** 半年：上半年 1-6 月，下半年 7-12 月 */
export function halfYearRange(d: Date = new Date()) {
  const h1 = d.getMonth() < 6;
  const start = new Date(d.getFullYear(), h1 ? 0 : 6, 1);
  const end = new Date(d.getFullYear(), h1 ? 5 : 11, h1 ? 30 : 31);
  return {
    start: ymd(start),
    end: ymd(end),
    label: `${d.getFullYear()}年${h1 ? '上' : '下'}半年`
  };
}

/** 最近 N 天区间（含今天） */
export function lastDaysRange(n: number, d: Date = new Date()) {
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - (n - 1));
  return { start: ymd(start), end: ymd(end), label: `近${n}天` };
}

/** 中文日期展示 */
export function cnDate(s: string | null | undefined): string {
  if (!s) return '未设置';
  const d = parseYmd(s);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 相对 DDL 的自然语言描述 */
export function ddlHint(due: string | null | undefined): {
  text: string;
  level: 'none' | 'safe' | 'soon' | 'overdue';
} {
  const n = diffDays(due);
  if (n === null) return { text: '无 DDL', level: 'none' };
  if (n < 0) return { text: `已逾期 ${-n} 天`, level: 'overdue' };
  if (n === 0) return { text: '今天到期', level: 'soon' };
  if (n === 1) return { text: '明天到期', level: 'soon' };
  if (n <= 3) return { text: `还有 ${n} 天`, level: 'soon' };
  if (n <= 7) return { text: `还有 ${n} 天`, level: 'safe' };
  return { text: `还有 ${n} 天`, level: 'safe' };
}

export const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '重要',
  urgent: '紧急'
};

export const STATUS_LABEL: Record<string, string> = {
  open: '进行中',
  done: '已完成',
  archived: '已归档'
};
