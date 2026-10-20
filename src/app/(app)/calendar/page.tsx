'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loading } from '@/components/ui';
import type { TaskDto } from '@/types';

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/tasks?status=all&limit=500');
        const json = await res.json();
        if (json.ok) setTasks(json.data.rows.filter((t: TaskDto) => t.due_date));
      } catch {
        /* 静默 */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // 周一为 0
  const daysInMonth = lastDay.getDate();

  function taskDateKey(d: string) {
    return d;
  }

  const byDate = new Map<string, TaskDto[]>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    const arr = byDate.get(t.due_date) || [];
    arr.push(t);
    byDate.set(t.due_date, arr);
  }

  const cells: { date: Date | null; key: string }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null, key: `pad-${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date: dt, key });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, key: `pad-end-${cells.length}` });

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  function prevMonth() {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else setMonth(month + 1);
  }

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthTasks = tasks.filter((t) => t.due_date?.startsWith(monthPrefix));
  const openCount = monthTasks.filter((t) => t.status === 'open').length;
  const doneCount = monthTasks.filter((t) => t.status !== 'open').length;

  if (loading) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <button className="btn btn-sm" onClick={prevMonth}>
          ← 上月
        </button>
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 17,
            fontWeight: 600,
            minWidth: 130,
            textAlign: 'center'
          }}
        >
          {year} 年 {month + 1} 月
        </div>
        <button className="btn btn-sm" onClick={nextMonth}>
          下月 →
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setYear(now.getFullYear());
            setMonth(now.getMonth());
          }}
        >
          回到本月
        </button>
        <div className="toolbar-spacer" />
        <span className="chip chip-red">进行中 {openCount}</span>
        <span className="chip chip-ok">已完成 {doneCount}</span>
      </div>

      <div className="panel" style={{ overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            background: 'var(--ink-50)',
            borderBottom: '1px solid var(--border)'
          }}
        >
          {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d) => (
            <div
              key={d}
              style={{
                padding: '8px 0',
                textAlign: 'center',
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--ink-500)'
              }}
            >
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((cell) => {
            if (!cell.date) {
              return (
                <div
                  key={cell.key}
                  style={{
                    minHeight: 96,
                    borderRight: '1px solid var(--ink-100)',
                    borderBottom: '1px solid var(--ink-100)',
                    background: '#fcfbf9'
                  }}
                />
              );
            }
            const dayTasks = byDate.get(cell.key) || [];
            const isToday = cell.key === todayKey;
            const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;

            return (
              <div
                key={cell.key}
                style={{
                  minHeight: 96,
                  padding: '6px 7px',
                  borderRight: '1px solid var(--ink-100)',
                  borderBottom: '1px solid var(--ink-100)',
                  background: isToday ? 'var(--red-50)' : isWeekend ? '#fdfcfa' : '#fff',
                  outline: isToday ? '1px solid var(--red-600)' : 'none',
                  outlineOffset: -1
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? 'var(--red-700)' : 'var(--ink-500)',
                    marginBottom: 4
                  }}
                >
                  {cell.date.getDate()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {dayTasks.slice(0, 3).map((t) => {
                    const overdue =
                      t.status === 'open' && t.due_date && t.due_date < todayKey;
                    const done = t.status !== 'open';
                    return (
                      <Link
                        key={t.id}
                        href={`/tasks/${t.id}`}
                        title={t.title}
                        style={{
                          fontSize: 10.5,
                          padding: '2px 5px',
                          borderRadius: 3,
                          background: done
                            ? 'var(--ok-bg)'
                            : overdue
                              ? 'var(--danger-bg)'
                              : 'var(--gold-100)',
                          color: done ? 'var(--ok)' : overdue ? 'var(--danger)' : 'var(--gold-700)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                          lineHeight: 1.5
                        }}
                      >
                        {t.title}
                      </Link>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <span style={{ fontSize: 10, color: 'var(--ink-400)', paddingLeft: 4 }}>
                      另 {dayTasks.length - 3} 项
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--ink-400)' }}>
        日历按 DDL 展示。红色为逾期未完成，金色为进行中，绿色为已完成。
      </div>
    </>
  );
}
