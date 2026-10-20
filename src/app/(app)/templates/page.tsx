'use client';

import { useState, useEffect } from 'react';
import { Empty, Loading, ConfirmDialog, Modal } from '@/components/ui';
import { useShell } from '@/components/Shell';
import type { TemplateDto, TagDto, CurrentUser } from '@/types';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function TemplatesPage() {
  const { user, toast } = useShell();
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: '',
    detail: '',
    done_criteria: '',
    cadence: 'weekly' as 'weekly' | 'monthly',
    weekday: 5,
    month_day: 25,
    due_offset: 0,
    priority: 'normal',
    owner_id: '',
    tag_ids: [] as number[]
  });

  const isAdmin = user?.role === 'admin';

  async function load() {
    try {
      const res = await fetch('/api/templates');
      const json = await res.json();
      if (json.ok) setTemplates(json.data);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetch('/api/tags').then((r) => r.json()).then((j) => j.ok && setTags(j.data)).catch(() => {});
    if (isAdmin) {
      fetch('/api/users').then((r) => r.json()).then((j) => j.ok && setUsers(j.data)).catch(() => {});
    }
  }, [isAdmin]);

  async function create() {
    if (!form.title.trim()) {
      toast('请填写模板名称', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          owner_id: form.owner_id ? Number(form.owner_id) : null
        })
      });
      const json = await res.json();
      if (json.ok) {
        setShowForm(false);
        toast(
          json.data.generated > 0
            ? `模板已创建，并已生成 ${json.data.generated} 项本周工作`
            : '模板已创建，将在到期前自动生成工作实例',
          'success'
        );
        setForm({ ...form, title: '', detail: '', done_criteria: '', tag_ids: [] });
        load();
      } else toast(json.error || '创建失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(id: number, enabled: number) {
    await fetch('/api/templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled: enabled ? 0 : 1 })
    });
    load();
  }

  async function doDelete() {
    if (!deleteId) return;
    const res = await fetch(`/api/templates?id=${deleteId}`, { method: 'DELETE' });
    const json = await res.json();
    setDeleteId(null);
    if (json.ok) {
      toast('模板已删除', 'success');
      load();
    } else toast(json.error || '删除失败', 'error');
  }

  async function manualGenerate() {
    const res = await fetch('/api/templates', { method: 'PUT' });
    const json = await res.json();
    if (json.ok) {
      toast(
        json.data.generated > 0
          ? `已生成 ${json.data.generated} 项工作`
          : '当前无需要生成的周期工作',
        'success'
      );
      load();
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
          周期模板定义固定动作的重复规则，到期前 7 天自动生成工作实例，每个周期仅生成一次
        </div>
        <div className="toolbar-spacer" />
        <button className="btn btn-sm" onClick={manualGenerate}>
          立即检查生成
        </button>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + 新建模板
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="panel">
          <Empty
            title="暂无周期模板"
            desc="适用于「每周报送」「每月总结」这类固定动作，设置一次后系统自动按周期生成工作"
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
                新建第一个模板
              </button>
            }
          />
        </div>
      ) : (
        <div className="panel scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>模板名称</th>
                <th style={{ width: 100 }}>周期</th>
                <th style={{ width: 130 }}>生成规则</th>
                <th style={{ width: 90 }}>责任人</th>
                <th style={{ width: 100 }}>上次生成</th>
                <th style={{ width: 80 }}>状态</th>
                <th style={{ width: 130 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-900)' }}>
                      {t.title}
                    </div>
                    {t.done_criteria && (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>
                        {t.done_criteria}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="chip chip-gold">
                      {t.cadence === 'weekly' ? '每周' : '每月'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-600)' }}>
                    {t.cadence === 'weekly'
                      ? `${WEEKDAYS[(t.weekday || 5) - 1]}到期`
                      : `每月 ${t.month_day} 日到期`}
                    {t.due_offset ? `（偏移 ${t.due_offset} 天）` : ''}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{t.owner_name || '—'}</td>
                  <td style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                    {t.last_run_period || '尚未生成'}
                  </td>
                  <td>
                    <span className={`chip ${t.enabled ? 'chip-ok' : 'chip-muted'}`}>
                      {t.enabled ? '启用' : '停用'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => toggle(t.id, t.enabled)}>
                        {t.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        className="btn btn-sm btn-ghost btn-danger"
                        onClick={() => setDeleteId(t.id)}
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

      {showForm && (
        <Modal
          title="新建周期模板"
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={create} disabled={saving}>
                {saving ? '创建中…' : '创建'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">
              模板名称<span className="req">*</span>
            </label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="如：每周周报报送"
            />
          </div>
          <div className="field">
            <label className="field-label">工作详情</label>
            <textarea
              className="textarea"
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              placeholder="固定动作的说明，会带入每次生成的工作实例"
            />
          </div>
          <div className="field">
            <label className="field-label">完成条件</label>
            <textarea
              className="textarea"
              style={{ minHeight: 56 }}
              value={form.done_criteria}
              onChange={(e) => setForm({ ...form, done_criteria: e.target.value })}
            />
          </div>

          <div className="form-row-3">
            <div className="field">
              <label className="field-label">周期类型</label>
              <select
                className="select"
                value={form.cadence}
                onChange={(e) =>
                  setForm({ ...form, cadence: e.target.value as 'weekly' | 'monthly' })
                }
              >
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>
            </div>
            {form.cadence === 'weekly' ? (
              <div className="field">
                <label className="field-label">到期星期</label>
                <select
                  className="select"
                  value={form.weekday}
                  onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i + 1}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="field">
                <label className="field-label">到期日</label>
                <input
                  type="number"
                  className="input"
                  min="1"
                  max="28"
                  value={form.month_day}
                  onChange={(e) => setForm({ ...form, month_day: Number(e.target.value) })}
                />
              </div>
            )}
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

          <div className="alert alert-info">
            生成规则：系统在到期日进入 7 天提醒窗口时自动生成工作实例，同一周期只生成一次，不会重复。
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          message="删除模板后不再自动生成新的周期工作，已生成的工作实例会保留。确定删除？"
          onCancel={() => setDeleteId(null)}
          onConfirm={doDelete}
          confirmText="确认删除"
        />
      )}
    </>
  );
}
