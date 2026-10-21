import { requireUserFrom } from '@/lib/auth';
import { dashboardStats, queryTasks } from '@/lib/tasks';
import { isoWeek, today, ymd } from '@/lib/date';
import { generateFromTemplates } from '@/lib/templates';
import { ok } from './http';
import { guard } from './guard';

/**
 * 工作台首页聚合接口
 *
 * 首页原来是服务端组件、直接调库。改成客户端组件后，把原来那几段查询原样搬到这里，
 * 一次请求把整页要用的数据取全，避免首页发四五个并发请求。
 */
export function dashboardGet(req: Request): Promise<Response> {
  return guard(async () => {
    const user = requireUserFrom(req);

    try {
      generateFromTemplates();
    } catch (e) {
      console.error('[templates]', e);
    }

    const scope = user.role === 'admin' ? null : user.id;
    const stats = dashboardStats(scope);
    const week = isoWeek();

    // 重点待办：逾期 + 今日 + 3 天内
    const { rows: urgent } = queryTasks({
      status: 'open',
      restrictToOwner: scope ?? undefined,
      dueTo: ymd(new Date(Date.now() + 3 * 86400000)),
      limit: 8,
      sort: 'due'
    });

    const { rows: recent } = queryTasks({
      status: 'open',
      restrictToOwner: scope ?? undefined,
      limit: 6,
      sort: 'updated'
    });

    const { rows: doneWeekRows } = queryTasks({
      status: 'all',
      restrictToOwner: scope ?? undefined,
      rangeStart: week.start,
      rangeEnd: week.end,
      limit: 5,
      sort: 'updated'
    });

    const doneWeek = doneWeekRows.filter((t) => t.status !== 'open');

    return ok({ user, stats, week, urgent, recent, doneWeek, today: ymd(today()) });
  });
}
