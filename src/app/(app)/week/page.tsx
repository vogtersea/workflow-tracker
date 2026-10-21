'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Loading, Empty, DueChip, PriorityChip, StatusChip, TagPills } from '@/components/ui';
import { useShell } from '@/components/Shell';
import type { TaskDto, CurrentUser } from '@/types';

interface Bucket {
  weekStart: string;
  weekEnd: string;
  label: string;
  year: number;
  week: number;
  done: TaskDto[];
  due: TaskDto[];
  progress: TaskDto[];
  open: TaskDto[];
  stats: {
    total: number;
    done: number;
    due: number;
    overdue: number;
    progress: number;
    open: number;
    completionRate: number;
  };
}

interface TrendPoint {
  weekStart: string;
  weekEnd: string;
  label: string;
  done: number;
  due: number;
  total: number;
}

const SECTIONS: { key: 'done' | 'due' | 'progress' | 'open'; title: string; hint: string }[] = [
  { key: 'done', title: '本周已完成', hint: '销号时间落在本周' },
  { key: 'due', title: '本周到期', hint: 'DDL 落在本周' },
  { key: 'progress', title: '本周有推进', hint: '本周新增进展记录' },
  { key: 'open', title: '在办待推进', hint: '本周既无进展也未到期' }
];

function TaskLine({ t }: { t: TaskDto }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 0',
        borderBottom: '1px solid var(--ink-100)',
        fontSize: 13
      }}
    >
      <Link
        href={`/tasks/${t.id}`}
        style={{
          fontWeight: 500,
          color: 'var(--ink-900)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {t.title}
      </Link>
      {t.project_name && (
        <span className="chip chip-tag" style={{ fontSize: 10.5, flexShrink: 0 }}>
          <span className="dot" style={{ background: t.project_color || '#7f1d1d' }} />
          {t.project_name}
        </span>
      )}
      {t.tags?.length ? (
        <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <TagPills tags={t.tags.slice(0, 2)} />
        </span>
      ) : null}
      <span style={{ flexShrink: 0 }}>
        <DueChip dueDate={t.due_date} status={t.status} />
      </span>
      <span style={{ flexShrink: 0 }}>
        <PriorityChip priority={t.priority} />
      </span>
      <span
        style={{
          fontSize: 11.5,
          color: 'var(--ink-400)',
          width: 54,
          textAlign: 'right',
          flexShrink: 0
        }}
      >
        {t.owner_name || '—'}
      </span>
    </div>
  );
}

export default function WeekPage() {
  const { user } = useShell();
  const [offset, setOffset] = useState(0);
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [owner, setOwner] = useState('all');

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ offset: String(offset), trend: '8' });
      if (owner !== 'all') q.set('owner', owner);
      const res = await fetch(`/api/week?${q}`);
      const json = await res.json();
      if (json.ok) {
        setBucket(json.data.bucket);
        setTrend(json.data.trend);
      }
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, [offset, owner]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/users')
      .then((r) => r.json())
      .then((j) => j.ok && setUsers(j.data))
      .catch(() => {});
  }, [isAdmin]);

  const maxTrend = Math.max(1, ...trend.map((t) => t.total));

  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setOffset(offset - 1)}>
            ← 上一周
          </button>
          <button className="btn btn-sm" onClick={() => setOffset(0)} disabled={offset === 0}>
            本周
          </button>
          <button className="btn btn-sm" onClick={() => setOffset(offset + 1)}>
            下一周 →
          </button>
        </div>
        {isAdmin && (
          <select
            className="select"
            style={{ width: 130 }}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="all">全部责任人</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        )}
        <div className="toolbar-spacer" />
        {bucket && (
          <Link href={`/reports/new?week=${bucket.weekStart}`} className="btn btn-sm btn-gold">
            生成本周总结
          </Link>
        )}
      </div>

      {loading && !bucket ? (
        <Loading />
      ) : !bucket ? (
        <div className="panel">
          <Empty title="加载失败" desc="无法读取周视图数据，请稍后重试" />
        </div>
      ) : (
        <>
          {/* 周概览 */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header">
              <div className="panel-title">
                {bucket.label}　{bucket.weekStart} 至 {bucket.weekEnd}
                {offset === 0 && (
                  <span className="chip chip-red" style={{ marginLeft: 8, fontSize: 10.5 }}>
                    本周
                  </span>
                )}
              </div>
            </div>
            <div className="panel-body">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                  gap: 12
                }}
              >
                {[
                  { label: '本周完成', value: bucket.stats.done, color: 'var(--ok)' },
                  { label: '本周到期', value: bucket.stats.due, color: 'var(--red-700)' },
                  { label: '逾期未完成', value: bucket.stats.overdue, color: 'var(--danger)' },
                  { label: '本周有推进', value: bucket.stats.progress, color: 'var(--gold-600)' },
                  { label: '在办待推进', value: bucket.stats.open, color: 'var(--ink-400)' },
                  { label: '完成率', value: `${bucket.stats.completionRate}%`, color: 'var(--ink-900)' }
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      border: '1px solid var(--ink-100)',
                      borderRadius: 6,
                      padding: '10px 12px'
                    }}
                  >
                    <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{s.label}</div>
                    <div
                      style={{
                        fontSize: 21,
                        fontWeight: 700,
                        color: s.color,
                        marginTop: 2,
                        fontFamily: 'var(--font-serif)'
                      }}
                    >
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 近 8 周趋势 */}
          {trend.length > 1 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header">
                <div className="panel-title">近 {trend.length} 周走势</div>
                <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
                  <span style={{ color: 'var(--ok)' }}>■</span> 完成　
                  <span style={{ color: 'var(--gold-500)' }}>■</span> 到期
                </div>
              </div>
              <div className="panel-body">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 10,
                    height: 96,
                    padding: '0 4px'
                  }}
                >
                  {trend.map((p) => {
                    const isCur = p.weekStart === bucket.weekStart;
                    const h = (v: number) => Math.round((v / maxTrend) * 74);
                    return (
                      <div
                        key={p.weekStart}
                        style={{ flex: 1, textAlign: 'center', minWidth: 0 }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'center',
                            gap: 2,
                            height: 78
                          }}
                        >
                          <div
                            title={`到期 ${p.due}`}
                            style={{
                              width: 12,
                              height: Math.max(h(p.due), p.due ? 3 : 0),
                              background: isCur ? 'var(--gold-600)' : 'var(--gold-500)',
                              opacity: isCur ? 1 : 0.55,
                              borderRadius: '2px 2px 0 0'
                            }}
                          />
                          <div
                            title={`完成 ${p.done}`}
                            style={{
                              width: 12,
                              height: Math.max(h(p.done), p.done ? 3 : 0),
                              background: isCur ? 'var(--ok)' : 'var(--ok)',
                              opacity: isCur ? 1 : 0.5,
                              borderRadius: '2px 2px 0 0'
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: isCur ? 'var(--ink-900)' : 'var(--ink-400)',
                            marginTop: 4,
                            fontWeight: isCur ? 700 : 400
                          }}
                        >
                          {p.label.replace(/^\d{4}-/, '')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 四个分桶 */}
          <div className="split split-even">
            {SECTIONS.map((sec) => {
              const list = (bucket[sec.key] as TaskDto[]) || [];
              return (
                <div className="panel" key={sec.key}>
                  <div className="panel-header">
                    <div className="panel-title">
                      {sec.title}
                      <span
                        style={{ fontSize: 11.5, color: 'var(--ink-400)', marginLeft: 8, fontWeight: 400 }}
                      >
                        {sec.hint}
                      </span>
                    </div>
                    <div
                      style={{
                        marginLeft: 'auto',
                        fontSize: 12,
                        color: 'var(--ink-500)',
                        fontWeight: 600
                      }}
                    >
                      {list.length} 项
                    </div>
                  </div>
                  <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
                    {list.length === 0 ? (
                      <div
                        style={{
                          padding: '22px 0',
                          textAlign: 'center',
                          color: 'var(--ink-400)',
                          fontSize: 12.5
                        }}
                      >
                        本周无此类工作
                      </div>
                    ) : (
                      list.map((t) => <TaskLine key={`${sec.key}-${t.id}`} t={t} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
