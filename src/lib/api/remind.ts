import { runReminderJob } from '@/lib/reminders';
import { ok, fail } from './http';
import { guard } from './guard';

/**
 * 外部定时触发入口（同构）
 *
 * 安全约束：必须配置 JOB_TOKEN，且请求头 x-job-token 完全一致；
 * 未配置时一律 403 —— 绝不能出现「没配就等于不校验」。
 * 由于服务端已按 remind.lastRunDate 幂等，边车「每小时打一次」是安全的。
 *
 * JOB_TOKEN 属于服务端环境变量，由 route.ts 通过 meta 注入，
 * 本文件不直接读 process.env。
 */
export function remindPost(req: Request, meta: { jobToken: string }): Promise<Response> {
  return guard(async () => {
    const expected = meta.jobToken || '';
    const given = req.headers.get('x-job-token') || '';

    if (!expected || given !== expected) {
      return fail('forbidden', 403);
    }

    const force = new URL(req.url).searchParams.get('force') === '1';
    const data = await runReminderJob({ force });
    return ok(data);
  });
}
