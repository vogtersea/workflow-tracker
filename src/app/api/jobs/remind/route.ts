// 副作用导入：向同构层注册 node:sqlite 实现（instrumentation 在 dev 下不保证先执行）
import '@/lib/db';
import { remindPost } from '@/lib/api/remind';

export const dynamic = 'force-dynamic';

/**
 * 外部定时触发入口（可选后备）
 *
 * 安全约束：必须配置 JOB_TOKEN，且请求头 x-job-token 完全一致；
 * 未配置时一律 403 —— 绝不能出现「没配就等于不校验」。
 */
export async function POST(req: Request) {
  return remindPost(req, { jobToken: process.env.JOB_TOKEN || '' });
}
