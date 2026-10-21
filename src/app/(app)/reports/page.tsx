'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Empty, Loading, ConfirmDialog } from '@/components/ui';
import { useShell } from '@/components/Shell';

interface Report {
  id: number;
  scope: string;
  title: string;
  range_start: string | null;
  range_end: string | null;
  model: string | null;
  created_at: string;
  author: string | null;
}

const SCOPE_LABEL: Record<string, string> = {
  single: '单项',
  week: '周报',
  month: '月报',
  half_year: '半年报',
  year: '年度',
  custom: '自定义'
};

export default function ReportsPage() {
  const { toast } = useShell();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/reports');
      const json = await res.json();
      if (json.ok) setReports(json.data);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function doDelete() {
    if (!deleteId) return;
    const res = await fetch(`/api/reports/${deleteId}`, { method: 'DELETE' });
    const json = await res.json();
    setDeleteId(null);
    if (json.ok) {
      toast('报告已删除', 'success');
      load();
    } else toast(json.error || '删除失败', 'error');
  }

  async function exportToVault(id: number) {
    setExporting(id);
    try {
      const res = await fetch(`/api/reports/${id}/export?format=vault`);
      const json = await res.json();
      if (json.ok) toast(`已写入知识库：${json.data.path}`, 'success');
      else toast(json.error || '写入失败', 'error');
    } catch {
      toast('网络异常', 'error');
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
          共 {reports.length} 份报告，可按 Word、Markdown、PDF 或知识库写回方式导出
        </div>
        <div className="toolbar-spacer" />
        <Link href="/reports/new" className="btn btn-primary">
          + 生成新报告
        </Link>
      </div>

      {loading ? (
        <Loading />
      ) : reports.length === 0 ? (
        <div className="panel">
          <Empty
            title="暂无总结报告"
            desc="可针对单项工作或按周、月、半年、年及自定义区间生成总结报告"
            action={
              <Link href="/reports/new" className="btn btn-primary btn-sm">
                生成第一份报告
              </Link>
            }
          />
        </div>
      ) : (
        <div className="panel scroll-x">
          <table className="table table-card">
            <thead>
              <tr>
                <th>报告标题</th>
                <th style={{ width: 70 }}>类型</th>
                <th style={{ width: 190 }}>统计区间</th>
                <th style={{ width: 90 }}>生成人</th>
                <th style={{ width: 130 }}>生成时间</th>
                <th style={{ width: 260 }}>导出</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td data-label="">
                    <Link
                      href={`/reports/${r.id}`}
                      style={{ fontWeight: 600, color: 'var(--ink-900)', fontSize: 13.5 }}
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td data-label="类型">
                    <span className="chip chip-tag">{SCOPE_LABEL[r.scope] || r.scope}</span>
                  </td>
                  <td data-label="区间" style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                    {r.range_start && r.range_end ? `${r.range_start} ~ ${r.range_end}` : '—'}
                  </td>
                  <td data-label="生成人" style={{ fontSize: 12.5, color: 'var(--ink-600)' }}>{r.author || '—'}</td>
                  <td data-label="时间" style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                    {r.created_at.slice(0, 16)}
                  </td>
                  <td data-label="">
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <a
                        href={`/api/reports/${r.id}/export?format=docx`}
                        className="btn btn-sm btn-ghost"
                      >
                        Word
                      </a>
                      <a
                        href={`/api/reports/${r.id}/export?format=md`}
                        className="btn btn-sm btn-ghost"
                      >
                        MD
                      </a>
                      <a
                        href={`/api/reports/${r.id}/export?format=html`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-ghost"
                      >
                        PDF
                      </a>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => exportToVault(r.id)}
                        disabled={exporting === r.id}
                      >
                        {exporting === r.id ? '写入中…' : '写知识库'}
                      </button>
                      <button
                        className="btn btn-sm btn-ghost btn-danger"
                        onClick={() => setDeleteId(r.id)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          message="确定删除该报告？删除后需重新调用大模型生成。"
          onCancel={() => setDeleteId(null)}
          onConfirm={doDelete}
          confirmText="确认删除"
        />
      )}
    </>
  );
}
