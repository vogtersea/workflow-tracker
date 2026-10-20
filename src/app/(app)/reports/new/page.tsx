'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useShell } from '@/components/Shell';
import type { TaskDto } from '@/types';
import { isoWeek, monthRange, halfYearRange, yearRange, ymd } from '@/lib/date';

type Scope = 'single' | 'week' | 'month' | 'half_year' | 'year' | 'custom';

const SCOPES: { key: Scope; label: string; desc: string }[] = [
  { key: 'single', label: '单项工作', desc: '针对某一项具体工作生成总结' },
  { key: 'week', label: '周总结', desc: '按自然周汇总本周工作' },
  { key: 'month', label: '月度总结', desc: '按自然月汇总月度工作' },
  { key: 'half_year', label: '半年总结', desc: '按上/下半年汇总' },
  { key: 'year', label: '年度总结', desc: '按自然年汇总全年工作' },
  { key: 'custom', label: '自定义区间', desc: '任意起止日期' }
];

export default function NewReportPage() {
  const router = useRouter();
  const { toast } = useShell();

  const [scope, setScope] = useState<Scope>('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [extra, setExtra] = useState('');
  const [title, setTitle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ id: number; content: string } | null>(null);
  const [error, setError] = useState('');
  const [llmOk, setLlmOk] = useState<boolean | null>(null);

  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [taskId, setTaskId] = useState('');
  const [taskSearch, setTaskSearch] = useState('');

  useEffect(() => {
    const now = new Date();
    const m = monthRange(now);
    setCustomStart(m.start);
    setCustomEnd(ymd(now));

    fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => j.ok && setLlmOk(j.data.llmConfigured))
      .catch(() => setLlmOk(false));
  }, []);

  useEffect(() => {
    if (scope !== 'single') return;
    fetch('/api/tasks?status=all&limit=200&sort=updated')
      .then((r) => r.json())
      .then((j) => j.ok && setTasks(j.data.rows))
      .catch(() => {});
  }, [scope]);

  const currentRange = (() => {
    const now = new Date();
    if (scope === 'week') {
      const w = isoWeek(now);
      return `${w.start} 至 ${w.end}`;
    }
    if (scope === 'month') {
      const m = monthRange(now);
      return `${m.start} 至 ${m.end}`;
    }
    if (scope === 'half_year') {
      const h = halfYearRange(now);
      return `${h.start} 至 ${h.end}`;
    }
    if (scope === 'year') {
      const y = yearRange(now);
      return `${y.start} 至 ${y.end}`;
    }
    if (scope === 'custom') return `${customStart} 至 ${customEnd}`;
    return '按所选工作';
  })();

  async function generate() {
    setError('');
    if (scope === 'single' && !taskId) {
      setError('请先选择要总结的工作');
      return;
    }
    if (scope === 'custom') {
      if (!customStart || !customEnd) {
        setError('请填写自定义区间的起止日期');
        return;
      }
      if (customStart > customEnd) {
        setError('起始日期不能晚于结束日期');
        return;
      }
    }

    setGenerating(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = { scope, title: title || undefined, extraInstruction: extra || undefined };
      if (scope === 'single') {
        body.taskId = Number(taskId);
        const sel = tasks.find((t) => t.id === Number(taskId));
        body.taskTitle = sel?.title;
      }
      const url =
        scope === 'custom'
          ? `/api/reports?start=${customStart}&end=${customEnd}`
          : '/api/reports';

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.ok) {
        setResult({ id: json.data.id, content: json.data.content });
        toast('报告生成完成', 'success');
      } else {
        setError(json.error || '生成失败');
      }
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setGenerating(false);
    }
  }

  const filteredTasks = tasks.filter(
    (t) => !taskSearch || t.title.toLowerCase().includes(taskSearch.toLowerCase())
  );

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link href="/reports" style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
          ← 报告列表
        </Link>
      </div>

      {llmOk === false && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          尚未配置大模型，无法生成报告。请前往{' '}
          <Link href="/settings" style={{ color: 'var(--red-700)', fontWeight: 600 }}>
            系统设置
          </Link>{' '}
          填写接口地址、API Key 与模型名称。支持 DeepSeek、通义千问、Kimi、豆包，以及 one-api、Ollama 等 OpenAI 兼容服务。
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
        {/* 左侧配置 */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">报告设置</div>
          </div>
          <div className="panel-body">
            <div className="field">
              <label className="field-label">报告类型</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SCOPES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setScope(s.key);
                      setResult(null);
                      setError('');
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '9px 12px',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${scope === s.key ? 'var(--red-600)' : 'var(--border)'}`,
                      background: scope === s.key ? 'var(--red-50)' : '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: scope === s.key ? 'var(--red-700)' : 'var(--ink-800)'
                      }}
                    >
                      {s.label}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 1 }}>
                      {s.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {scope === 'single' && (
              <>
                <div className="field">
                  <label className="field-label">搜索工作</label>
                  <input
                    className="input"
                    placeholder="输入关键词筛选"
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label">
                    选择工作<span className="req">*</span>
                  </label>
                  <select
                    className="select"
                    value={taskId}
                    onChange={(e) => setTaskId(e.target.value)}
                    size={6}
                    style={{ height: 'auto', minHeight: 130 }}
                  >
                    {filteredTasks.length === 0 && <option value="">无匹配工作</option>}
                    {filteredTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {scope === 'custom' && (
              <div className="form-row">
                <div className="field">
                  <label className="field-label">起始日期</label>
                  <input
                    type="date"
                    className="input"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label">结束日期</label>
                  <input
                    type="date"
                    className="input"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="field">
              <label className="field-label">报告标题（可选）</label>
              <input
                className="input"
                placeholder="留空则自动命名"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">额外写作要求（可选）</label>
              <textarea
                className="textarea"
                style={{ minHeight: 64 }}
                placeholder="如：侧重团队协作与效率提升，控制在1500字以内"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </div>

            <div
              style={{
                fontSize: 11.5,
                color: 'var(--ink-500)',
                background: 'var(--ink-50)',
                padding: '9px 12px',
                borderRadius: 'var(--radius)',
                marginBottom: 14,
                lineHeight: 1.7
              }}
            >
              <strong style={{ color: 'var(--ink-700)' }}>统计区间：</strong>
              {currentRange}
              <br />
              系统会先计算完成率、逾期数等事实数据，再连同工作明细与进展记录交给大模型，要求其严格基于材料写作。
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              onClick={generate}
              disabled={generating || llmOk === false}
            >
              {generating ? (
                <>
                  <span className="spinner" />
                  生成中…
                </>
              ) : (
                '生成报告'
              )}
            </button>
          </div>
        </div>

        {/* 右侧结果 */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">报告预览</div>
            {result && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <a
                  href={`/api/reports/${result.id}/export?format=docx`}
                  className="btn btn-sm btn-gold"
                >
                  导出 Word
                </a>
                <a
                  href={`/api/reports/${result.id}/export?format=md`}
                  className="btn btn-sm"
                >
                  MD
                </a>
                <Link href={`/reports/${result.id}`} className="btn btn-sm">
                  详情
                </Link>
              </div>
            )}
          </div>
          <div className="panel-body">
            {generating ? (
              <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                <span className="spinner dark" style={{ marginRight: 8, verticalAlign: -2 }} />
                <span style={{ color: 'var(--ink-600)', fontSize: 13.5 }}>
                  正在调用大模型生成报告…
                </span>
                <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 12 }}>
                  通常需要 20 至 90 秒，请勿关闭页面
                </div>
              </div>
            ) : result ? (
              <div className="report-body" dangerouslySetInnerHTML={{ __html: mdToHtml(result.content) }} />
            ) : (
              <div className="empty" style={{ padding: '60px 20px' }}>
                <div className="empty-title">报告将在此处显示</div>
                <div className="empty-desc">
                  在左侧选择报告类型与统计区间，点击「生成报告」
                  <br />
                  生成结果会自动保存，可在报告列表中随时查看与导出
                </div>
              </div>
            )}
          </div>
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
