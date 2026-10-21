'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Modal, ConfirmDialog, Empty, Loading, DueChip, PriorityChip, StatusChip, TagPills } from '@/components/ui';
import { useShell } from '@/components/Shell';
import type { TaskDto, TagDto, CurrentUser, CadenceDto, ProjectDto } from '@/types';

const PRIORITIES = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '重要' },
  { value: 'normal', label: '普通' },
  { value: 'low', label: '低' }
];

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const CADENCE_OPTIONS: { value: CadenceDto; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'quarterly', label: '每季度' },
  { value: 'halfyearly', label: '每半年' },
  { value: 'yearly', label: '每年' }
];

interface FormState {
  id?: number;
  /** oneoff=一次性工作；routine=例行固定工作（按周期重复） */
  kind: 'oneoff' | 'routine';
  title: string;
  detail: string;
  done_criteria: string;
  due_date: string;
  priority: string;
  owner_id: string;
  tag_ids: number[];
  estimate_hours: string;
  /** 所属项目 */
  project_id: string;
  /** 例行工作周期 */
  cadence: CadenceDto;
  weekday: number;
  month_day: number;
  month_no: number;
  due_offset: number;
}

const EMPTY_FORM: FormState = {
  kind: 'oneoff',
  title: '',
  detail: '',
  done_criteria: '',
  due_date: '',
  priority: 'normal',
  owner_id: '',
  tag_ids: [],
  estimate_hours: '',
  project_id: '',
  cadence: 'monthly',
  weekday: 5,
  month_day: 28,
  month_no: 12,
  due_offset: 0
};

function TasksInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, toast, refreshBadges } = useShell();

  const [rows, setRows] = useState<TaskDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);

  const [status, setStatus] = useState<'open' | 'done' | 'archived'>('open');
  const [keyword, setKeyword] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState(params.get('project') || '');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [filter, setFilter] = useState(params.get('filter') || '');

  const [showForm, setShowForm] = useState(params.get('new') === '1');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ status, limit: '300' });
      if (keyword) q.set('q', keyword);
      if (tagFilter) q.set('tag', tagFilter);
      if (projectFilter) q.set('project', projectFilter);
      if (ownerFilter !== 'all') q.set('owner', ownerFilter);

      const res = await fetch(`/api/tasks?${q}`);
      const json = await res.json();
      if (json.ok) {
        let list: TaskDto[] = json.data.rows;
        // 前端二次过滤（临近/逾期）
        if (filter === 'overdue') {
          const t = new Date();
          const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
          list = list.filter(
            (x) => x.status === 'open' && x.due_date && new Date(x.due_date).getTime() < t0
          );
        } else if (filter === 'due_soon') {
          const t = new Date();
          const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
          list = list.filter((x) => {
            if (x.status !== 'open' || !x.due_date) return false;
            const d = new Date(x.due_date).getTime();
            return d >= t0 && d <= t0 + 3 * 86400000;
          });
        }
        setRows(list);
        setTotal(json.data.total);
      } else {
        toast(json.error || '加载失败', 'error');
      }
    } catch {
      toast('网络异常', 'error');
    } finally {
      setLoading(false);
    }
  }, [status, keyword, tagFilter, projectFilter, ownerFilter, filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
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
  }, [isAdmin]);

  // URL 参数联动
  useEffect(() => {
    if (params.get('new') === '1') {
      setShowForm(true);
      setForm(EMPTY_FORM);
    }
  }, [params]);

  function openNew() {
    setForm({ ...EMPTY_FORM, owner_id: isAdmin ? '' : String(user?.id ?? '') });
    setFormError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.title.trim()) {
      setFormError('请填写工作名称');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      // 例行固定工作：落到周期模板，并立即生成本周期实例
      if (form.kind === 'routine') {
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title.trim(),
            detail: form.detail,
            done_criteria: form.done_criteria,
            cadence: form.cadence,
            weekday: form.weekday,
            month_day: form.month_day,
            month_no: form.month_no,
            due_offset: form.due_offset,
            priority: form.priority,
            owner_id: form.owner_id ? Number(form.owner_id) : null,
            tag_ids: form.tag_ids
          })
        });
        const json = await res.json();
        if (!json.ok) {
          setFormError(json.error || '保存失败');
          return;
        }
        setShowForm(false);
        setForm(EMPTY_FORM);
        toast(
          json.data.generated > 0
            ? '例行工作已建立，本周期工作已生成'
            : '例行工作已建立，将在到期前自动生成',
          'success'
        );
        refreshBadges();
        load();
        if (params.get('new') === '1') router.replace('/tasks');
        return;
      }

      const payload = {
        title: form.title.trim(),
        detail: form.detail,
        done_criteria: form.done_criteria,
        due_date: form.due_date || null,
        priority: form.priority,
        owner_id: form.owner_id ? Number(form.owner_id) : null,
        tag_ids: form.tag_ids,
        estimate_hours: form.estimate_hours ? Number(form.estimate_hours) : null,
        project_id: form.project_id ? Number(form.project_id) : null
      };
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.ok) {
        setFormError(json.error || '保存失败');
        setSaving(false);
        return;
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      toast('工作已创建', 'success');
      refreshBadges();
      load();
      if (params.get('new') === '1') router.replace('/tasks');
    } catch {
      setFormError('网络异常');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: number, next: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next })
    });
    const json = await res.json();
    if (json.ok) {
      toast(next === 'done' ? '已标记完成' : next === 'archived' ? '已归档' : '已恢复', 'success');
      refreshBadges();
      load();
    } else {
      toast(json.error || '操作失败', 'error');
    }
  }

  async function doDelete() {
    if (!deleteId) return;
    const res = await fetch(`/api/tasks/${deleteId}`, { method: 'DELETE' });
    const json = await res.json();
    setDeleteId(null);
    if (json.ok) {
      toast('已删除', 'success');
      refreshBadges();
      load();
    } else {
      toast(json.error || '删除失败', 'error');
    }
  }

  const tabs: { key: 'open' | 'done' | 'archived'; label: string }[] = [
    { key: 'open', label: '进行中' },
    { key: 'done', label: '已完成' },
    { key: 'archived', label: '归档区' }
  ];

  return (
    <>
      <div className="toolbar">
        <div className="search-input">
          <input
            placeholder="搜索工作名称、详情、完成条件"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <select
          className="select"
          style={{ width: 130 }}
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
        >
          <option value="">全部标签</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 150 }}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">全部项目</option>
          <option value="0">未归入项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select
            className="select"
            style={{ width: 130 }}
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
          >
            <option value="all">全部责任人</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        )}
        {filter && (
          <button className="chip chip-red" onClick={() => setFilter('')}>
            {filter === 'overdue' ? '已逾期' : '临近到期'} ×
          </button>
        )}
        {projectFilter && (
          <button className="chip chip-gold" onClick={() => setProjectFilter('')}>
            {projectFilter === '0'
              ? '未归入项目'
              : projects.find((p) => String(p.id) === projectFilter)?.name || '项目'}{' '}
            ×
          </button>
        )}
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={openNew}>
          + 新增工作
        </button>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab ${status === t.key ? 'active' : ''}`}
            onClick={() => setStatus(t.key)}
          >
            {t.label}
            {t.key === 'open' && total > 0 && status === 'open' ? ` (${total})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="panel">
          <Empty
            title={status === 'open' ? '暂无进行中的工作' : status === 'done' ? '暂无已完成工作' : '归档区为空'}
            desc={
              filter
                ? '当前筛选条件下没有匹配的工作，可清除筛选后查看全部'
                : '点击「新增工作」创建工作，并设置完成条件与 DDL'
            }
            action={
              !filter && status === 'open' ? (
                <button className="btn btn-primary btn-sm" onClick={openNew}>
                  新增第一项工作
                </button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="panel scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>工作名称</th>
                <th style={{ width: 100 }}>DDL</th>
                <th style={{ width: 70 }}>优先级</th>
                <th style={{ width: 90 }}>责任人</th>
                <th style={{ width: 120 }}>项目</th>
                <th style={{ width: 130 }}>标签</th>
                <th style={{ width: 80 }}>进展</th>
                <th style={{ width: 110 }}>状态</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Link
                        href={`/tasks/${t.id}`}
                        style={{ fontWeight: 600, color: 'var(--ink-900)', fontSize: 13.5 }}
                      >
                        {t.title}
                      </Link>
                      {t.template_id && (
                        <span className="chip chip-gold" style={{ fontSize: 10 }}>
                          例行
                        </span>
                      )}
                    </div>
                    {t.done_criteria && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--ink-400)',
                          marginTop: 3,
                          maxWidth: 420,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        完成条件：{t.done_criteria}
                      </div>
                    )}
                  </td>
                  <td>
                    <DueChip dueDate={t.due_date} status={t.status} />
                  </td>
                  <td>
                    <PriorityChip priority={t.priority} />
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--ink-600)' }}>
                    {t.owner_name || '—'}
                  </td>
                  <td>
                    {t.project_name ? (
                      <span className="chip chip-tag">
                        <span className="dot" style={{ background: t.project_color || '#7f1d1d' }} />
                        {t.project_name}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ink-300)' }}>—</span>
                    )}
                  </td>
                  <td>{t.tags?.length ? <TagPills tags={t.tags} /> : <span style={{ color: 'var(--ink-300)' }}>—</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                    {t.progress_count ?? 0} 条
                  </td>
                  <td>
                    <StatusChip status={t.status} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Link href={`/tasks/${t.id}`} className="btn btn-sm btn-ghost">
                        详情
                      </Link>
                      {t.status === 'open' && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => changeStatus(t.id, 'done')}
                          style={{ color: 'var(--ok)' }}
                        >
                          销号
                        </button>
                      )}
                      {t.status === 'done' && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => changeStatus(t.id, 'archived')}
                        >
                          归档
                        </button>
                      )}
                      {t.status === 'archived' && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => changeStatus(t.id, 'open')}
                        >
                          恢复
                        </button>
                      )}
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
          title="新增工作"
          onClose={() => {
            setShowForm(false);
            if (params.get('new') === '1') router.replace('/tasks');
          }}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          {formError && <div className="alert alert-error">{formError}</div>}

          <div className="field">
            <label className="field-label">工作类型</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${form.kind === 'oneoff' ? 'btn-primary' : ''}`}
                onClick={() => setForm({ ...form, kind: 'oneoff' })}
              >
                一次性工作
              </button>
              <button
                type="button"
                className={`btn btn-sm ${form.kind === 'routine' ? 'btn-primary' : ''}`}
                onClick={() => setForm({ ...form, kind: 'routine' })}
              >
                例行固定工作
              </button>
            </div>
            <div className="field-hint">
              {form.kind === 'routine'
                ? '按天／周／月／季度／半年／年重复，到期前自动排入待办，每个周期生成一次'
                : '有明确起止的一次性事项，需要自己填 DDL'}
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              工作名称<span className="req">*</span>
            </label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={
                form.kind === 'routine' ? '如：每周工作报送' : '如：撰写XX季度工作总结材料'
              }
              autoFocus
            />
          </div>

          <div className="field">
            <label className="field-label">工作详情</label>
            <textarea
              className="textarea"
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              placeholder="说明任务背景、来源、具体要求与涉及范围"
            />
          </div>

          <div className="field">
            <label className="field-label">完成条件</label>
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              value={form.done_criteria}
              onChange={(e) => setForm({ ...form, done_criteria: e.target.value })}
              placeholder="明确可验收的交付标准，如：形成3000字汇报稿并经分管领导审定"
            />
            <div className="field-hint">完成条件是销号依据，建议写成可检验的具体标准</div>
          </div>

          {form.kind === 'routine' ? (
            <div className="form-row-3">
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
              </div>

              {form.cadence === 'weekly' && (
                <div className="field">
                  <label className="field-label">到期星期</label>
                  <select
                    className="select"
                    value={form.weekday}
                    onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                  >
                    {WEEKDAY_NAMES.map((w, i) => (
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

              {form.cadence !== 'daily' && form.cadence !== 'weekly' && (
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
                </div>
              )}

              <div className="field">
                <label className="field-label">优先级</label>
                <select
                  className="select"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

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
              </div>
            </div>
          ) : (
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
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="form-row">
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
              <div className="field">
                <label className="field-label">预估工时（小时）</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="0.5"
                  value={form.estimate_hours}
                  onChange={(e) => setForm({ ...form, estimate_hours: e.target.value })}
                  placeholder="可留空"
                />
              </div>
            </div>
          )}

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
            <div className="field-hint">
              {projects.length === 0
                ? '可在「项目分组」中创建项目'
                : '项目用于归入同一条工作线，标签用于分类，两者可同时使用'}
            </div>
          </div>

          <div className="field">
            <label className="field-label">标签</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tags.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                  暂无标签，可前往「标签管理」创建
                </span>
              )}
              {tags.map((t) => {
                const on = form.tag_ids.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip ${on ? 'chip-red' : 'chip-tag'}`}
                    style={{ cursor: 'pointer', border: on ? undefined : '1px solid var(--ink-200)' }}
                    onClick={() =>
                      setForm({
                        ...form,
                        tag_ids: on
                          ? form.tag_ids.filter((x) => x !== t.id)
                          : [...form.tag_ids, t.id]
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

      {deleteId && (
        <ConfirmDialog
          message="删除后该工作及其全部进展记录将不可恢复，确定删除？"
          onCancel={() => setDeleteId(null)}
          onConfirm={doDelete}
          confirmText="确认删除"
        />
      )}
    </>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TasksInner />
    </Suspense>
  );
}
