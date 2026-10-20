import { NextResponse } from 'next/server';
import { runReminderJob } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

/**
 * 外部定时触发入口（可选后备）
 *
 * 安全约束：必须配置 JOB_TOKEN，且请求头 x-job-token 完全一致；
 * 未配置时一律 403 —— 绝不能出现「没配就等于不校验」。
 * 由于服务端已按 remind.lastRunDate 幂等，边车「每小时打一次」是安全的。
 */
export async function POST(req: Request) {
  const expected = process.env.JOB_TOKEN || '';
  const given = req.headers.get('x-job-token') || '';

  if (!expected || given !== expected) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const force = new URL(req.url).searchParams.get('force') === '1';
  const data = await runReminderJob({ force });
  return NextResponse.json({ ok: true, data });
}
