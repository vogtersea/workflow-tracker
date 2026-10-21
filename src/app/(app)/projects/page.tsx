'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Empty, Loading, ConfirmDialog, Modal } from '@/components/ui';
import { useShell } from '@/components/Shell';
import type { ProjectDto } from '@/types';

const PRESET_COLORS = [
  '#7f1d1d',
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#1d4ed8',
  '#6d28d9',
  '#be185d'
];

export default function ProjectsPage() {
  const { toast } = useShell();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editColor, setEditColor] = useState(PRESET_COLORS[0]);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/projects${showArchived ? '?all=1' : ''}`);
      const json = await res.json();
      if (json.ok) setProjects(json.data);
      else toast(json.error || '加载失败', 'error');
    } catch {
      toast('网络异常', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [showArchived]);

  async function create() {
    if (!name.trim()) {
      toast('请输入项目名称', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: desc.trim(), color })
      });
      const json = await res.json();
      if (json.ok) {
        setName('');
        setDesc('');
        toast('项目已创建', 'success');
        load();
      } else toast(json.error || '创建失败', 'error');
    } catch {
      toast('网络异常', 'error');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(p: ProjectDto) {
    setEditing(p);
    setEditName(p.name);
    setEditDesc(p.description || '');
    setEditColor(p.color);
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editName.trim()) {
      toast('项目名称不能为空', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim(), color: editColor })
      });
      const json = await res.json();
      if (json.ok) {
        setEditing(null);
        toast('已保存', 'success');
        load();
      } else toast(json.error || '保存失败', 'error');
    } catch {
      toast('网络异常', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(p: ProjectDto) {
    const next = p.status === 'active' ? 'archived' : 'active';
    const res = await fetch(`/api/projects/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next })
    });
    const json = await res.json();
    if (json.ok) {
      toast(next === 'archived' ? '项目已归档' : '项目已恢复', 'success');
      load();
    } else toast(json.error || '操作失败', 'error');
  }

  async function doDelete() {
    if (!deleteId) return;
    const res = await fetch(`/api/projects?id=${deleteId}`, { method: 'DELETE' });
    const json = await res.json();
    setDeleteId(null);
    if (json.ok) {
      toast('项目已删除，相关工作已解除归属', 'success');
      load();
    } else toast(json.error || '删除失败', 'error');
  }

  if (loading) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
          项目用于把工作归入「某一件具体的事」，标签用于「某一类事」，两者可同时使用
        </span>
        <div className="toolbar-spacer" />
        <label
          style={{ fontSize: 12.5, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          显示已归档
        </label>
      </div>

      <div className="split split-side">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">新建项目</div>
          </div>
          <div className="panel-body">
            <div className="field">
              <label className="field-label">项目名称</label>
              <input
                className="input"
                placeholder="如：季度经营分析报告"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
            </div>
            <div className="field">
              <label className="field-label">说明</label>
              <textarea
                className="textarea"
                style={{ minHeight: 64 }}
                placeholder="简述该项目范围与目标，便于日后回溯"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">颜色</label>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 5,
                      background: c,
                      border: color === c ? '2px solid var(--ink-900)' : '2px solid transparent',
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={create}
              disabled={saving}
            >
              {saving ? '创建中…' : '创建项目'}
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">项目列表</div>
            <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
              共 {projects.length} 个
            </div>
          </div>
          {projects.length === 0 ? (
            <Empty title="暂无项目" desc="新建项目，用于把零散工作归入同一条线" />
          ) : (
            <div className="scroll-x">
              <table className="table table-card">
                <thead>
                  <tr>
                    <th>项目</th>
                    <th style={{ width: 300 }}>说明</th>
                    <th style={{ width: 200 }}>进度</th>
                    <th style={{ width: 150 }}>最近完成</th>
                    <th style={{ width: 170 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const total = p.task_count ?? 0;
                    const done = p.done_count ?? 0;
                    const pct = total ? Math.round((done / total) * 100) : 0;
                    return (
                      <tr key={p.id}>
                        <td data-label="">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="dot" style={{ background: p.color }} />
                            <span style={{ fontWeight: 600, color: 'var(--ink-900)', fontSize: 13.5 }}>
                              {p.name}
                            </span>
                            {p.status === 'archived' && (
                              <span className="chip" style={{ fontSize: 10 }}>
                                已归档
                              </span>
                            )}
                          </div>
                          {!!p.overdue_count && (
                            <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 3 }}>
                              逾期 {p.overdue_count} 项
                            </div>
                          )}
                        </td>
                        <td data-label="说明" style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
                          {p.description || '—'}
                        </td>
                        <td data-label="进度">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div
                              style={{
                                flex: 1,
                                height: 6,
                                borderRadius: 3,
                                background: 'var(--ink-100)',
                                overflow: 'hidden'
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: '100%',
                                  background: p.color
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>
                              {done}/{total}
                            </span>
                          </div>
                          {!!p.open_count && (
                            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                              进行中 {p.open_count} 项
                            </div>
                          )}
                        </td>
                        <td data-label="最近完成" style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                          {p.last_done_at ? p.last_done_at.slice(0, 10) : '—'}
                        </td>
                        <td data-label="">
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <Link href={`/tasks?project=${p.id}`} className="btn btn-sm btn-ghost">
                              查看工作
                            </Link>
                            <button className="btn btn-sm btn-ghost" onClick={() => openEdit(p)}>
                              编辑
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => toggleArchive(p)}>
                              {p.status === 'active' ? '归档' : '恢复'}
                            </button>
                            <button
                              className="btn btn-sm btn-ghost btn-danger"
                              onClick={() => setDeleteId(p.id)}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal
          title="编辑项目"
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">项目名称</label>
            <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">说明</label>
            <textarea
              className="textarea"
              style={{ minHeight: 64 }}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">颜色</label>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditColor(c)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 5,
                    background: c,
                    border: editColor === c ? '2px solid var(--ink-900)' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          message="删除项目后，挂在该项目下的工作不会被删除，但会解除归属关系。确定删除？"
          onCancel={() => setDeleteId(null)}
          onConfirm={doDelete}
          confirmText="确认删除"
        />
      )}
    </>
  );
}
