'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Loading } from '@/components/ui';
import { useShell } from '@/components/Shell';
import { api } from '@/lib/api-client';
import { useQueryParam } from '@/lib/use-query';

interface Report {
  id: number;
  scope: string;
  title: string;
  range_start: string | null;
  range_end: string | null;
  content_md: string;
  model: string | null;
  created_at: string;
  author: string | null;
}

export default function ReportDetailPage() {
  const { toast } = useShell();
  // 静态导出下不能用动态路由（无法预知 id），改用查询串 ?id=
  const qid = useQueryParam('id');
  const id = qid == null ? null : Number(qid);

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [vaultWriting, setVaultWriting] = useState(false);

  const load = useCallback(async () => {
    if (id == null) return;
    try {
      const res = await api(`/api/reports/${id}`);
      const json = await res.json();
      if (json.ok) {
        setReport(json.data);
        setDraft(json.data.content_md);
      }
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDraft() {
    setSaving(true);
    try {
      const res = await api(`/api/reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_md: draft })
      });
      const json = await res.json();
      if (json.ok) {
        toast('已保存修改', 'success');
        setEditing(false);
        load();
      } else toast(json.error || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function writeVault() {
    setVaultWriting(true);
    try {
      const res = await api(`/api/reports/${id}/export?format=vault`);
      const json = await res.json();
      if (json.ok) toast(`已写入：${json.data.path}`, 'success');
      else toast(json.error || '写入失败', 'error');
    } catch {
      toast('网络异常', 'error');
    } finally {
      setVaultWriting(false);
    }
  }

  if (loading) return <Loading />;
  if (!report) return <div className="panel"><div style={{ padding: 40, textAlign: 'center' }}>报告不存在</div></div>;

  return (
    <>
      <div className="toolbar no-print">
        <Link href="/reports" style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
          ← 报告列表
        </Link>
        <div className="toolbar-spacer" />
        {!editing ? (
          <>
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              编辑正文
            </button>
            <a href={`/api/reports/${id}/export?format=docx`} className="btn btn-sm btn-gold">
              导出 Word
            </a>
            <a href={`/api/reports/${id}/export?format=md`} className="btn btn-sm">
              导出 MD
            </a>
            <a
              href={`/api/reports/${id}/export?format=html`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm"
            >
              打印 / PDF
            </a>
            <button className="btn btn-sm" onClick={writeVault} disabled={vaultWriting}>
              {vaultWriting ? '写入中…' : '写知识库'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={() => { setEditing(false); setDraft(report.content_md); }}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" onClick={saveDraft} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-body" style={{ padding: '32px 44px 48px' }}>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 22,
              fontWeight: 700,
              textAlign: 'center',
              margin: '0 0 8px',
              color: 'var(--ink-900)',
              letterSpacing: 1
            }}
          >
            {report.title}
          </h1>
          <div
            style={{
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--ink-400)',
              marginBottom: 28,
              paddingBottom: 18,
              borderBottom: '1px solid var(--border)'
            }}
          >
            {report.range_start && report.range_end
              ? `${report.range_start} 至 ${report.range_end}　·　`
              : ''}
            生成于 {report.created_at.slice(0, 16)}
            {report.model ? `　·　模型 ${report.model}` : ''}
          </div>

          {editing ? (
            <textarea
              className="textarea"
              style={{ minHeight: 520, fontFamily: 'var(--font-serif)', fontSize: 14.5, lineHeight: 1.95 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <div
              className="report-body"
              dangerouslySetInnerHTML={{ __html: mdToHtml(report.content_md) }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return md
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const l = line.trimEnd();
      if (!l.trim()) return '';
      const h = l.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        const tag = lv === 1 ? 'h1' : lv === 2 ? 'h2' : 'h3';
        return `<${tag}>${inline(h[2])}</${tag}>`;
      }
      if (/^[-*+]\s+/.test(l)) return `<li>${inline(l.replace(/^[-*+]\s+/, ''))}</li>`;
      if (/^\d+[.、)]\s+/.test(l)) return `<li>${inline(l.replace(/^\d+[.、)]\s+/, ''))}</li>`;
      if (/^---+$/.test(l.trim())) return '<hr/>';
      return `<p>${inline(l)}</p>`;
    })
    .join('\n');

  function inline(s: string): string {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
}
