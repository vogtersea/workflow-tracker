'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Empty, Loading } from '@/components/ui';
import { useShell } from '@/components/Shell';
import { api } from '@/lib/api-client';

interface Noti {
  id: number;
  task_id: number | null;
  kind: string;
  level: string;
  title: string;
  body: string;
  seen: number;
  created_at: string;
  task_title: string | null;
  owner: string | null;
}

interface DueItem {
  taskId: number;
  title: string;
  dueDate: string;
  kind: 'overdue' | 'due_soon' | 'today';
  text: string;
  ownerName?: string;
}

export default function NotificationsPage() {
  const { toast, refreshBadges } = useShell();
  const [items, setItems] = useState<Noti[]>([]);
  const [due, setDue] = useState<DueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [aheadDays, setAheadDays] = useState(3);

  async function load() {
    try {
      const [nRes, sRes] = await Promise.all([
        api('/api/notifications'),
        api('/api/notifications?mode=scan')
      ]);
      const nJson = await nRes.json();
      const sJson = await sRes.json();
      if (nJson.ok) {
        setItems(nJson.data.items);
        setAheadDays(nJson.data.config.aheadDays);
      }
      if (sJson.ok) setDue(sJson.data);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markAll() {
    await api('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'markSeen', ids: 'all' })
    });
    toast('已全部标记为已读', 'success');
    refreshBadges();
    load();
  }

  async function runJob() {
    const res = await api('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'runJob' })
    });
    const json = await res.json();
    if (json.ok) {
      const d = json.data;
      toast(
        `扫描 ${d.scanned} 项，新增通知 ${d.created} 条${d.pushed ? '，Webhook 推送成功' : d.pushMessage ? `，推送：${d.pushMessage}` : ''}`,
        'success'
      );
      refreshBadges();
      load();
    }
  }

  const overdue = due.filter((d) => d.kind === 'overdue');
  const todayDue = due.filter((d) => d.kind === 'today');
  const soon = due.filter((d) => d.kind === 'due_soon');

  if (loading) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
          系统扫描 DDL 在 {aheadDays} 天内的未完成工作，并生成待办提醒
        </div>
        <div className="toolbar-spacer" />
        <button className="btn btn-sm" onClick={runJob}>
          立即扫描并推送
        </button>
        <button className="btn btn-sm" onClick={markAll}>
          全部标为已读
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent-red">
          <div className="stat-label">已逾期</div>
          <div className={`stat-value ${overdue.length ? 'danger' : ''}`}>{overdue.length}</div>
        </div>
        <div className="stat-card accent-red">
          <div className="stat-label">今日到期</div>
          <div className={`stat-value ${todayDue.length ? 'danger' : ''}`}>{todayDue.length}</div>
        </div>
        <div className="stat-card accent-warn">
          <div className="stat-label">{aheadDays} 天内到期</div>
          <div className={`stat-value ${soon.length ? 'warn' : ''}`}>{soon.length}</div>
        </div>
        <div className="stat-card accent-gold">
          <div className="stat-label">未读通知</div>
          <div className="stat-value">{items.filter((i) => !i.seen).length}</div>
        </div>
      </div>

      <div className="split split-even">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">待办清单</div>
          </div>
          <div style={{ padding: due.length ? '4px 0' : 0, maxHeight: 520, overflowY: 'auto' }}>
            {due.length === 0 ? (
              <Empty title="当前无临近或逾期工作" desc="所有工作均在正常推进中" />
            ) : (
              due.map((d) => (
                <Link
                  key={d.taskId}
                  href={`/tasks/${d.taskId}`}
                  style={{
                    display: 'block',
                    padding: '11px 18px',
                    borderBottom: '1px solid var(--ink-100)',
                    borderLeft: `3px solid ${d.kind === 'due_soon' ? 'var(--gold-500)' : 'var(--red-600)'}`
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', flex: 1 }}>
                      {d.title}
                    </span>
                    <span className={`chip ${d.kind === 'due_soon' ? 'chip-warn' : 'chip-danger'}`}>
                      {d.text}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                    DDL {d.dueDate}
                    {d.ownerName ? ` · ${d.ownerName}` : ''}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">通知记录</div>
          </div>
          <div style={{ padding: items.length ? '4px 0' : 0, maxHeight: 520, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <Empty title="暂无通知记录" desc="系统检测到临近或逾期工作时会在此生成记录" />
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  style={{
                    padding: '11px 18px',
                    borderBottom: '1px solid var(--ink-100)',
                    background: n.seen ? 'transparent' : 'var(--gold-50)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                    {!n.seen && <span className="dot" style={{ background: 'var(--red-600)' }} />}
                    <span style={{ fontSize: 12.5, fontWeight: n.seen ? 400 : 600, color: 'var(--ink-800)' }}>
                      {n.title}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                    {n.body} · {n.created_at.slice(5, 16)}
                    {n.owner ? ` · ${n.owner}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
