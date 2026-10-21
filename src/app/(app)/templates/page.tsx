'use client';

import { useState, useEffect } from 'react';
import { Empty, Loading, ConfirmDialog, Modal } from '@/components/ui';
import { useShell } from '@/components/Shell';
import type { TemplateDto, TagDto, CurrentUser, CadenceDto } from '@/types';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const CADENCE_OPTIONS: { value: CadenceDto; label: string; hint: string }[] = [
  { value: 'daily', label: '每天', hint: '每个工作日都要做的固定动作' },
  { value: 'weekly', label: '每周', hint: '如每周报送、每周例会材料' },
  { value: 'monthly', label: '每月', hint: '如月度报表、月度总结' },
  { value: 'quarterly', label: '每季度', hint: '如季度分析、季度考核材料' },
  { value: 'halfyearly', label: '每半年', hint: '如半年总结、半年检查' },
  { value: 'yearly', label: '每年', hint: '如年度总结、年度工作计划' }
];

const PERIOD_STATUS: Record<TemplateDto['period_status'], { text: string; cls: string }> = {
  none: { text: '未生成', cls: 'chip-muted' },
  open: { text: '进行中', cls: 'chip-gold' },
  done: { text: '已完成', cls: 'chip-ok' },
  archived: { text: '已归档', cls: 'chip-muted' }
};

function cadenceLabel(c: CadenceDto): string {
  return CADENCE_OPTIONS.find((o) => o.value === c)?.label || c;
}

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
    cadence: 'monthly' as CadenceDto,
    weekday: 5,
    month_day: 28,
    month_no: 12,
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
      toast('请填写工作名称', 'error');
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
            ? `例行工作已建立，本周期工作已生成`
            : '例行工作已建立，将在到期前自动生成',
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
      toast('例行工作已删除', 'success');
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

  const needDay = form.cadence !== 'daily' && form.cadence !== 'weekly';

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
          例行固定工作按天／周／月／季度／半年／年重复，到期前自动生成工作实例，每个周期只生成一次
        </div>
        <div className="toolbar-spacer" />
        <button className="btn btn-sm" onClick={manualGenerate}>
          立即检查生成
        </button>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + 新建例行工作
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="panel">
          <Empty
            title="暂无例行工作"
            desc="周报、月报、季度分析、年度总结这类固定动作，在这里设置一次，系统就按周期自动排进待办"
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
                新建第一个例行工作
              </button>
            }
          />
        </div>
      ) : (
        <div className="panel scroll-x">
          <table className="table table-card">
            <thead>
              <tr>
                <th>工作名称</th>
                <th style={{ width: 90 }}>周期</th>
                <th style={{ width: 220 }}>到期规则</th>
                <th style={{ width: 170 }}>本周期</th>
                <th style={{ width: 90 }}>责任人</th>
                <th style={{ width: 80 }}>状态</th>
                <th style={{ width: 130 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const ps = PERIOD_STATUS[t.period_status] || PERIOD_STATUS.none;
                return (
                  <tr key={t.id}>
                    <td data-label="">
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-900)' }}>
                        {t.title}
                      </div>
                      {t.done_criteria && (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>
                          {t.done_criteria}
                        </div>
                      )}
                    </td>
                    <td data-label="周期">
                      <span className="chip chip-gold">{cadenceLabel(t.cadence)}</span>
                    </td>
                    <td data-label="到期规则" style={{ fontSize: 12, color: 'var(--ink-600)' }}>{t.rule_text}</td>
                    <td data-label="本周期">
                      <div style={{ fontSize: 12.5, color: 'var(--ink-800)' }}>
                        {t.current_label}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginTop: 3,
                          fontSize: 11.5,
                          color: 'var(--ink-400)'
                        }}
                      >
                        <span className={`chip ${ps.cls}`} style={{ fontSize: 10.5 }}>
                          {ps.text}
                        </span>
                        <span>到期 {t.period_due}</span>
                      </div>
                    </td>
                    <td data-label="责任人" style={{ fontSize: 12.5 }}>{t.owner_name || '—'}</td>
                    <td data-label="状态">
                      <span className={`chip ${t.enabled ? 'chip-ok' : 'chip-muted'}`}>
                        {t.enabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td data-label="">
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal
          title="新建例行工作"
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
              工作名称<span className="req">*</span>
            </label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="如：每周工作报送"
              autoFocus
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
              placeholder="可验收的交付标准，会带入每次生成的工作实例"
            />
          </div>

          <div className="field">
            <label className="field-label">周期类型</label>
            <select
              className="select"
              value={form.cadence}
              onChange={(e) => setForm({ ...form, cadence: e.target.value as CadenceDto })}
            >
              {CADENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="field-hint">
              {CADENCE_OPTIONS.find((o) => o.value === form.cadence)?.hint}
            </div>
          </div>

          <div className="form-row-3">
            {form.cadence === 'weekly' && (
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
            )}

            {form.cadence === 'yearly' && (
              <div className="field">
                <label className="field-label">到期月份</label>
                <select
                  className="select"
                  value={form.month_no}
                  onChange={(e) => setForm({ ...form, month_no: Number(e.target.value) })}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m} 月
                    </option>
                  ))}
                </select>
              </div>
            )}

            {needDay && (
              <div className="field">
                <label className="field-label">到期日</label>
                <input
                  type="number"
                  className="input"
                  min="1"
                  max="31"
                  value={form.month_day}
                  onChange={(e) => setForm({ ...form, month_day: Number(e.target.value) })}
                />
                <div className="field-hint">超出当月天数时按月末计算</div>
              </div>
            )}

            <div className="field">
              <label className="field-label">顺延天数</label>
              <input
                type="number"
                className="input"
                min="-30"
                max="30"
                value={form.due_offset}
                onChange={(e) => setForm({ ...form, due_offset: Number(e.target.value) })}
              />
              <div className="field-hint">可为负数，表示提前</div>
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
            创建后立即生成本周期的工作；此后在到期前自动排入待办（每天提前 1 天、每周／每月提前 7
            天、每季度提前 14 天、每半年提前 21 天、每年提前 30 天），同一周期只生成一次。
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          message="删除后不再自动生成新的周期工作，已生成的工作实例会保留。确定删除？"
          onCancel={() => setDeleteId(null)}
          onConfirm={doDelete}
          confirmText="确认删除"
        />
      )}
    </>
  );
}
