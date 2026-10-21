'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading, ConfirmDialog, Modal } from '@/components/ui';
import { useShell } from '@/components/Shell';
import { api } from '@/lib/api-client';

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  active: number;
  created_at: string;
}

export default function UsersPage() {
  const router = useRouter();
  const { user, toast } = useShell();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    username: '',
    display_name: '',
    password: '',
    role: 'member' as 'admin' | 'member'
  });

  async function load() {
    try {
      const res = await api('/api/users');
      const json = await res.json();
      if (json.ok) setRows(json.data);
      else toast(json.error || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!form.username.trim() || !form.display_name.trim()) {
      toast('用户名与姓名必填', 'error');
      return;
    }
    if (form.password.length < 6) {
      toast('密码至少 6 位', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await api('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const json = await res.json();
      if (json.ok) {
        setShowForm(false);
        setForm({ username: '', display_name: '', password: '', role: 'member' });
        toast('用户已创建', 'success');
        load();
      } else toast(json.error || '创建失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function update(id: number, body: Record<string, unknown>) {
    const res = await api('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body })
    });
    const json = await res.json();
    if (json.ok) {
      toast('已更新', 'success');
      load();
    } else toast(json.error || '更新失败', 'error');
  }

  async function resetPwd() {
    if (!pwdUser) return;
    if (newPwd.length < 6) {
      toast('密码至少 6 位', 'error');
      return;
    }
    const res = await api('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resetPassword', id: pwdUser.id, password: newPwd })
    });
    const json = await res.json();
    if (json.ok) {
      toast('密码已重置，该用户需重新登录', 'success');
      setPwdUser(null);
      setNewPwd('');
    } else toast(json.error || '重置失败', 'error');
  }

  async function doDelete() {
    if (!deleteId) return;
    const res = await api(`/api/users?id=${deleteId}`, { method: 'DELETE' });
    const json = await res.json();
    setDeleteId(null);
    if (json.ok) {
      toast('用户已删除', 'success');
      load();
    } else toast(json.error || '删除失败', 'error');
  }

  if (loading) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
          管理员可查看全部工作，成员仅能查看与操作分配给自己的工作
        </div>
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + 新增用户
        </button>
      </div>

      <div className="panel scroll-x">
        <table className="table table-card">
          <thead>
            <tr>
              <th>姓名</th>
              <th style={{ width: 130 }}>用户名</th>
              <th style={{ width: 90 }}>角色</th>
              <th style={{ width: 80 }}>状态</th>
              <th style={{ width: 130 }}>创建时间</th>
              <th style={{ width: 260 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td data-label="" style={{ fontWeight: 600, fontSize: 13.5 }}>{u.display_name}</td>
                <td data-label="用户名" style={{ fontSize: 12.5, fontFamily: 'monospace', color: 'var(--ink-600)' }}>
                  {u.username}
                </td>
                <td data-label="角色">
                  <span className={`chip ${u.role === 'admin' ? 'chip-red' : 'chip-tag'}`}>
                    {u.role === 'admin' ? '管理员' : '成员'}
                  </span>
                </td>
                <td data-label="状态">
                  <span className={`chip ${u.active ? 'chip-ok' : 'chip-muted'}`}>
                    {u.active ? '正常' : '已停用'}
                  </span>
                </td>
                <td data-label="创建时间" style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                  {u.created_at.slice(0, 10)}
                </td>
                <td data-label="">
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPwdUser(u)}>
                      重置密码
                    </button>
                    <select
                      className="select"
                      style={{ width: 88, padding: '3px 6px', fontSize: 12 }}
                      value={u.role}
                      onChange={(e) => update(u.id, { role: e.target.value })}
                    >
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                    {u.id !== user?.id && (
                      <>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => update(u.id, { active: u.active ? 0 : 1 })}
                        >
                          {u.active ? '停用' : '启用'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost btn-danger"
                          onClick={() => setDeleteId(u.id)}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal
          title="新增用户"
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
          <div className="form-row">
            <div className="field">
              <label className="field-label">
                用户名<span className="req">*</span>
              </label>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="登录用，字母数字"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label className="field-label">
                姓名<span className="req">*</span>
              </label>
              <input
                className="input"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="显示名称"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label className="field-label">
                初始密码<span className="req">*</span>
              </label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="至少 6 位"
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label className="field-label">角色</label>
              <select
                className="select"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'member' })}
              >
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
        </Modal>
      )}

      {pwdUser && (
        <Modal
          title={`重置「${pwdUser.display_name}」的密码`}
          onClose={() => {
            setPwdUser(null);
            setNewPwd('');
          }}
          maxWidth={400}
          footer={
            <>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setPwdUser(null);
                  setNewPwd('');
                }}
              >
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={resetPwd}>
                确认重置
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">新密码</label>
            <input
              className="input"
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="至少 6 位"
              autoFocus
            />
            <div className="field-hint">重置后该用户所有已登录会话将失效</div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          message="删除用户后，该用户创建的工作会保留，但责任人字段将被清空。确定删除？"
          onCancel={() => setDeleteId(null)}
          onConfirm={doDelete}
          confirmText="确认删除"
        />
      )}
    </>
  );
}
