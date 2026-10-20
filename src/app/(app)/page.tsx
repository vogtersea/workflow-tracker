import { getCurrentUser } from '@/lib/auth';
import { dashboardStats, queryTasks } from '@/lib/tasks';
import { isoWeek, today, ymd, cnDate } from '@/lib/date';
import { generateFromTemplates } from '@/lib/templates';
import Link from 'next/link';
import { DueChip, PriorityChip, TagPills, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  try {
    generateFromTemplates();
  } catch (e) {
    console.error('[templates]', e);
  }

  const scope = user.role === 'admin' ? null : user.id;
  const stats = dashboardStats(scope);
  const week = isoWeek();

  // 重点待办：逾期 + 今日 + 3天内
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

  const { rows: doneWeek } = queryTasks({
    status: 'all',
    restrictToOwner: scope ?? undefined,
    rangeStart: week.start,
    rangeEnd: week.end,
    limit: 5,
    sort: 'updated'
  });

  const doneThisWeekItems = doneWeek.filter((t) => t.status !== 'open');
  const total = stats.open + doneThisWeekItems.length + stats.overdue;
  const completionRate =
    stats.open + stats.doneThisWeek > 0
      ? Math.round((stats.doneThisWeek / (stats.open + stats.doneThisWeek)) * 100)
      : 0;

  return (
    <>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--ink-900)',
              margin: '0 0 4px',
              letterSpacing: 0.5
            }}
          >
            工作台概览
          </h1>
          <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
            {cnDate(ymd(today()))} · {week.label} · {user.display_name}
            {user.role === 'admin' ? '（管理员全辖视图）' : '（个人视图）'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/tasks?new=1" className="btn btn-primary">
            + 新增工作
          </Link>
          <Link href="/reports/new" className="btn btn-gold">
            生成报告
          </Link>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="stat-grid">
        <div className="stat-card accent-red">
          <div className="stat-label">进行中</div>
          <div className="stat-value">{stats.open}</div>
          <div className="stat-hint">待推进工作项</div>
        </div>
        <div className="stat-card accent-red">
          <div className="stat-label">
            <span className="dot" style={{ background: 'var(--danger)' }} />
            已逾期
          </div>
          <div className={`stat-value ${stats.overdue > 0 ? 'danger' : ''}`}>{stats.overdue}</div>
          <div className="stat-hint">{stats.overdue > 0 ? '需立即处理' : '暂无逾期'}</div>
        </div>
        <div className="stat-card accent-warn">
          <div className="stat-label">3 日内到期</div>
          <div className={`stat-value ${stats.dueSoon > 0 ? 'warn' : ''}`}>{stats.dueSoon}</div>
          <div className="stat-hint">今日到期 {stats.todayDue} 项</div>
        </div>
        <div className="stat-card accent-ok">
          <div className="stat-label">本周完成</div>
          <div className="stat-value ok">{stats.doneThisWeek}</div>
          <div className="stat-hint">完成率约 {completionRate}%</div>
        </div>
        <div className="stat-card accent-gold">
          <div className="stat-label">已归档</div>
          <div className="stat-value">{stats.archived}</div>
          <div className="stat-hint">销号留存记录</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* 重点待办 */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">重点待办</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Link href="/tasks?filter=overdue" className="btn btn-sm btn-ghost">
                查看全部
              </Link>
            </div>
          </div>
          <div style={{ padding: urgent.length ? '4px 0' : 0 }}>
            {urgent.length === 0 ? (
              <Empty
                title="暂无临近或逾期工作"
                desc="当前所有工作进行正常，可继续新增或推进已有事项"
                action={
                  <Link href="/tasks?new=1" className="btn btn-sm btn-primary">
                    新增工作
                  </Link>
                }
              />
            ) : (
              urgent.map((t) => {
                const days = t.due_date
                  ? Math.round(
                      (new Date(t.due_date).getTime() -
                        new Date(ymd(today())).getTime()) /
                        86400000
                    )
                  : null;
                return (
                  <Link
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    style={{
                      display: 'block',
                      padding: '12px 18px',
                      borderBottom: '1px solid var(--ink-100)',
                      borderLeft: `3px solid ${days !== null && days < 0 ? 'var(--red-600)' : days === 0 ? 'var(--red-600)' : 'var(--gold-500)'}`
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 4,
                        flexWrap: 'wrap'
                      }}
                    >
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>
                        {t.title}
                      </span>
                      <DueChip dueDate={t.due_date} status={t.status} />
                      <PriorityChip priority={t.priority} />
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--ink-500)',
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        alignItems: 'center'
                      }}
                    >
                      {t.owner_name && <span>责任人：{t.owner_name}</span>}
                      <span>进展 {t.progress_count ?? 0} 条</span>
                      {t.tags?.length > 0 && <TagPills tags={t.tags} />}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">最近推进</div>
            </div>
            <div style={{ padding: recent.length ? '4px 0' : 0 }}>
              {recent.length === 0 ? (
                <Empty title="暂无进行中的工作" />
              ) : (
                recent.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    style={{
                      display: 'block',
                      padding: '10px 18px',
                      borderBottom: '1px solid var(--ink-100)'
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--ink-800)',
                        marginBottom: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                      {t.last_progress_at
                        ? `${t.last_progress_at.slice(5, 16)} 更新`
                        : '尚未记录进展'}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {stats.noProgress > 0 && (
            <div className="panel">
              <div className="panel-body">
                <div className="alert alert-warn" style={{ margin: 0 }}>
                  有 <strong>{stats.noProgress}</strong> 项进行中的工作尚未记录任何进展。
                  建议及时补充进展记录，便于后续生成总结报告。
                </div>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">本周完成</div>
              <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
                {week.start} ~ {week.end}
              </div>
            </div>
            <div style={{ padding: doneThisWeekItems.length ? '4px 0' : 0 }}>
              {doneThisWeekItems.length === 0 ? (
                <Empty title="本周暂无完成记录" />
              ) : (
                doneThisWeekItems.map((t) => (
                  <div
                    key={t.id}
                    style={{ padding: '9px 18px', borderBottom: '1px solid var(--ink-100)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ color: 'var(--ok)', fontSize: 12 }}>✓</span>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-700)' }}>{t.title}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
