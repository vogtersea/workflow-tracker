'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfirmDialog, Loading, StatusChip, PriorityChip, DueChip, TagPills, Modal } from '@/components/ui';
import { useShell } from '@/components/Shell';
import type { TaskDto, ProgressDto, TagDto, CurrentUser, ProjectDto } from '@/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/date';

type Detail = TaskDto & { progress: ProgressDto[] };

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, toast, refreshBadges } = useShell();
  const id = Number(params.id);

  const [task, setTask] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [content, setContent] = useState('');
  const [percent, setPercent] = useState('');
  const [posting, setPosting] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: '',
    detail: '',
    done_criteria: '',
    due_date: '',
    priority: 'normal',
    owner_id: '',
    estimate_hours: '',
    actual_hours: '',
    project_id: '',
    tag_ids: [] as number[]
  });
  const [tags, setTags] = useState<TagDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [saving, setSaving] = useState(false);

  const [deleteProgressId, setDeleteProgressId] = useState<number | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [reportDegraded, setReportDegraded] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [showReport, setShowReport] = useState(false);

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${id}`);
      const json = await res.json();
      if (json.ok) {
        setTask(json.data);
      } else {
        setError(json.error || '加载失败');
      }
    } catch {
      setError('网络异常');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    fetch('/api/tags')
      .then((r) => r.json())
      .then((j) => j.ok && setTags(j.data))
      .catch(() => {});
    fetch('/api/projects')
      .then((r) => r.json())
      .then((j) => j.ok && setProjects(j.data))
      .catch(() => {});
    if (isAdmin) {
      fetch('/api/users')
        .then((r) => r.json())
        .then((j) => j.ok && setUsers(j.data))
        .catch(() => {});
    }
  }, [load, isAdmin]);

  async function addProgress() {
    if (!content.trim()) {
      toast('请填写进展内容', 'error');
      return;
    }
    setPosting(true);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), percent: percent || null })
      });
      const json = await res.json();
      if (json.ok) {
        setTask(json.data);
        setContent('');
        setPercent('');
        toast('进展已记录', 'success');
        refreshBadges();
      } else {
        toast(json.error || '添加失败', 'error');
      }
    } catch {
      toast('网络异常', 'error');
    } finally {
      setPosting(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.ok) {
      setTask(json.data);
      refreshBadges();
      return true;
    }
    toast(json.error || '操作失败', 'error');
    return false;
  }

  function startEdit() {
    if (!task) return;
    setForm({
      title: task.title,
      detail: task.detail,
      done_criteria: task.done_criteria,
      due_date: task.due_date || '',
      priority: task.priority,
      owner_id: task.owner_id ? String(task.owner_id) : '',
      estimate_hours: task.estimate_hours != null ? String(task.estimate_hours) : '',
      actual_hours: task.actual_hours != null ? String(task.actual_hours) : '',
      project_id: task.project_id ? String(task.project_id) : '',
      tag_ids: task.tags?.map((t) => t.id) || []
    });
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    const ok = await patch({
      title: form.title,
      detail: form.detail,
      done_criteria: form.done_criteria,
      due_date: form.due_date || null,
      priority: form.priority,
      owner_id: form.owner_id ? Number(form.owner_id) : null,
      estimate_hours: form.estimate_hours ? Number(form.estimate_hours) : null,
      actual_hours: form.actual_hours ? Number(form.actual_hours) : null,
      project_id: form.project_id ? Number(form.project_id) : null,
      tag_ids: form.tag_ids
    });
    setSaving(false);
    if (ok) {
      setEditing(false);
      toast('已保存', 'success');
    }
  }

  async function doDeleteTask() {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) {
      toast('已删除', 'success');
      router.replace('/tasks');
    } else {
      toast(json.error || '删除失败', 'error');
      setShowDelete(false);
    }
  }

  async function deleteProgress() {
    if (!deleteProgressId) return;
    // 通过重新添加无法删除，这里用专用行为：直接调用 PATCH 不支持，改用后端接口
    const res = await fetch(`/api/tasks/${id}/progress?id=${deleteProgressId}`, {
      method: 'DELETE'
    });
    const json = await res.json();
    setDeleteProgressId(null);
    if (json.ok) {
      toast('进展记录已删除', 'success');
      load();
    } else {
      toast(json.error || '删除失败', 'error');
    }
  }

  async function genReport() {
    if (!task) return;
    setGenerating(true);
    setShowReport(true);
    setReportContent('');
    setReportDegraded(false);
    setReportReason('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'single',
          taskId: task.id,
          taskTitle: task.title,
          title: `${task.title}总结`
        })
      });
      const json = await res.json();
      if (json.ok) {
        setReportContent(json.data.content);
        setReportDegraded(Boolean(json.data.degraded));
        setReportReason(json.data.reason || '');
      } else {
        setReportContent(`生成失败：${json.error}`);
      }
    } catch {
      setReportContent('网络异常，生成失败');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Loading />;
  if (error)
    return (
      <div className="panel">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-500)' }}>
          {error}
          <div style={{ marginTop: 16 }}>
            <Link href="/tasks" className="btn btn-sm">
              返回工作列表
            </Link>
          </div>
        </div>
      </div>
    );
  if (!task) return null;

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Link href="/tasks" style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
          ← 工作管理
        </Link>
        <span style={{ color: 'var(--ink-300)' }}>/</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>工作详情</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* 左侧主体 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-body">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <h1
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: 19,
                    fontWeight: 700,
                    color: 'var(--ink-900)',
                    margin: 0,
                    lineHeight: 1.45,
                    flex: 1
                  }}
                >
                  {task.title}
                </h1>
              </div>

              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
                <StatusChip status={task.status} />
                <DueChip dueDate={task.due_date} status={task.status} />
                <PriorityChip priority={task.priority} />
                {task.period_label && (
                  <span className="chip chip-gold">周期 {task.period_label}</span>
                )}
                {task.project_name && (
                  <span className="chip chip-tag">
                    <span className="dot" style={{ background: task.project_color || '#7f1d1d' }} />
                    {task.project_name}
                  </span>
                )}
                {task.tags?.length > 0 && <TagPills tags={task.tags} />}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={startEdit}>
                  编辑
                </button>
                {task.status === 'open' && (
                  <button
                    className="btn btn-sm btn-gold"
                    onClick={async () => {
                      if (await patch({ status: 'done' })) toast('已销号完成', 'success');
                    }}
                  >
                    标记完成
                  </button>
                )}
                {task.status === 'done' && (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      if (await patch({ status: 'archived' })) toast('已归档', 'success');
                    }}
                  >
                    归档
                  </button>
                )}
                {(task.status === 'done' || task.status === 'archived') && (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      if (await patch({ status: 'open' })) toast('已恢复为进行中', 'success');
                    }}
                  >
                    重新打开
                  </button>
                )}
                <button className="btn btn-sm" onClick={genReport}>
                  生成总结
                </button>
                <div style={{ marginLeft: 'auto' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => setShowDelete(true)}>
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">工作详情</div>
            </div>
            <div className="panel-body">
              {task.detail ? (
                <div style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--ink-700)', whiteSpace: 'pre-wrap' }}>
                  {task.detail}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--ink-400)' }}>未填写工作详情</div>
              )}

              <div className="divider" />

              <div className="section-title">完成条件</div>
              {task.done_criteria ? (
                <div
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.85,
                    color: 'var(--ink-700)',
                    whiteSpace: 'pre-wrap',
                    padding: '10px 14px',
                    background: 'var(--gold-50)',
                    borderLeft: '3px solid var(--gold-500)',
                    borderRadius: '0 4px 4px 0'
                  }}
                >
                  {task.done_criteria}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--ink-400)' }}>未设置完成条件</div>
              )}
            </div>
          </div>

          {/* 进展记录 */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">进展记录</div>
              <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
                共 {task.progress.length} 条
              </div>
            </div>
            <div className="panel-body">
              <div style={{ marginBottom: 18 }}>
                <textarea
                  className="textarea"
                  style={{ minHeight: 72 }}
                  placeholder="记录本次推进情况，如：已完成初稿撰写，正在送审"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 9, marginTop: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 110 }}
                    min="0"
                    max="100"
                    placeholder="进度 %"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                  />
                  <button className="btn btn-primary btn-sm" onClick={addProgress} disabled={posting}>
                    {posting ? '提交中…' : '添加进展'}
                  </button>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                    进展记录将作为生成总结报告的主要素材
                  </span>
                </div>
              </div>

              {task.progress.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>
                  暂无进展记录
                </div>
              ) : (
                <div className="timeline">
                  {task.progress.map((p, i) => (
                    <div key={p.id} className={`timeline-item ${i === 0 ? 'latest' : ''}`}>
                      <div className="timeline-meta">
                        <span style={{ fontWeight: 600, color: 'var(--ink-600)' }}>
                          {p.user_name || '未知'}
                        </span>
                        <span>{p.created_at.slice(0, 16)}</span>
                        {p.percent != null && <span className="chip chip-gold">{p.percent}%</span>}
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ marginLeft: 'auto', color: 'var(--ink-300)', padding: '0 4px' }}
                          onClick={() => setDeleteProgressId(p.id)}
                          title="删除该记录"
                        >
                          ×
                        </button>
                      </div>
                      <div className="timeline-content">{p.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧信息 */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">基本信息</div>
          </div>
          <div className="panel-body">
            <dl className="kv">
              <dt>负责人</dt>
              <dd>{task.owner_name || '未指定'}</dd>
              <dt>DDL</dt>
              <dd>{task.due_date || '未设置'}</dd>
              <dt>所属周</dt>
              <dd>{task.week_start || '—'}</dd>
              <dt>所属项目</dt>
              <dd>
                {task.project_name ? (
                  <Link href={`/projects`} style={{ color: 'var(--red-700)' }}>
                    {task.project_name}
                  </Link>
                ) : (
                  '未归入项目'
                )}
              </dd>
              <dt>优先级</dt>
              <dd>{PRIORITY_LABEL[task.priority] || task.priority}</dd>
              <dt>状态</dt>
              <dd>{STATUS_LABEL[task.status] || task.status}</dd>
              {task.estimate_hours != null && (
                <>
                  <dt>预估工时</dt>
                  <dd>{task.estimate_hours} 小时</dd>
                </>
              )}
              {task.actual_hours != null && (
                <>
                  <dt>实际工时</dt>
                  <dd>{task.actual_hours} 小时</dd>
                </>
              )}
              <dt>创建时间</dt>
              <dd style={{ fontSize: 12.5 }}>{task.created_at.slice(0, 16)}</dd>
              {task.done_at && (
                <>
                  <dt>完成时间</dt>
                  <dd style={{ fontSize: 12.5 }}>{task.done_at.slice(0, 16)}</dd>
                </>
              )}
              {task.archived_at && (
                <>
                  <dt>归档时间</dt>
                  <dd style={{ fontSize: 12.5 }}>{task.archived_at.slice(0, 16)}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>

      {editing && (
        <Modal
          title="编辑工作"
          onClose={() => setEditing(false)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setEditing(false)}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">工作名称</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label">工作详情</label>
            <textarea
              className="textarea"
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label">完成条件</label>
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              value={form.done_criteria}
              onChange={(e) => setForm({ ...form, done_criteria: e.target.value })}
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label className="field-label">DDL</label>
              <input
                type="date"
                className="input"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">优先级</label>
              <select
                className="select"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="urgent">紧急</option>
                <option value="high">重要</option>
                <option value="normal">普通</option>
                <option value="low">低</option>
              </select>
            </div>
          </div>
          <div className="form-row-3">
            {isAdmin && (
              <div className="field">
                <label className="field-label">责任人</label>
                <select
                  className="select"
                  value={form.owner_id}
                  onChange={(e) => setForm({ ...form, owner_id: e.target.value })}
                >
                  <option value="">未指定</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label className="field-label">预估工时</label>
              <input
                type="number"
                className="input"
                min="0"
                step="0.5"
                value={form.estimate_hours}
                onChange={(e) => setForm({ ...form, estimate_hours: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">实际工时</label>
              <input
                type="number"
                className="input"
                min="0"
                step="0.5"
                value={form.actual_hours}
                onChange={(e) => setForm({ ...form, actual_hours: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label className="field-label">所属项目</label>
            <select
              className="select"
              value={form.project_id}
              onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            >
              <option value="">不归入项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">标签</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tags.map((t) => {
                const on = form.tag_ids.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip ${on ? 'chip-red' : 'chip-tag'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() =>
                      setForm({
                        ...form,
                        tag_ids: on ? form.tag_ids.filter((x) => x !== t.id) : [...form.tag_ids, t.id]
                      })
                    }
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {showReport && (
        <Modal
          title="单项工作总结"
          onClose={() => setShowReport(false)}
          wide
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setShowReport(false)}>
                关闭
              </button>
              <Link href="/reports" className="btn btn-sm btn-gold">
                查看报告列表
              </Link>
            </>
          }
        >
          {generating ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-500)' }}>
              <span className="spinner dark" style={{ marginRight: 8, verticalAlign: -2 }} />
              正在调用大模型生成总结，请稍候…
              <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 10 }}>
                生成期间请勿关闭页面，通常需要 20 至 60 秒
              </div>
            </div>
          ) : (
            <>
              {reportDegraded && (
                <div className="alert alert-warn" style={{ marginBottom: 14 }}>
                  <strong>本次为结构预览，未调用模型。</strong>
                  {reportReason ||
                    '以下内容由系统按数据库中的客观事实自动排布，数据真实，但不包含自动撰写的成效表述。'}
                </div>
              )}
              <div className="report-body" dangerouslySetInnerHTML={{ __html: mdToHtml(reportContent) }} />
            </>
          )}
        </Modal>
      )}

      {showDelete && (
        <ConfirmDialog
          message={`删除「${task.title}」将同时清除其全部进展记录，且不可恢复。确认删除？`}
          onCancel={() => setShowDelete(false)}
          onConfirm={doDeleteTask}
          confirmText="确认删除"
        />
      )}

      {deleteProgressId && (
        <ConfirmDialog
          message="确定删除这条进展记录？删除后将无法用于报告生成。"
          onCancel={() => setDeleteProgressId(null)}
          onConfirm={deleteProgress}
          confirmText="确认删除"
        />
      )}
    </>
  );
}

/** 轻量 Markdown → HTML（仅支持标题、列表、粗体、段落） */
function mdToHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }
}
