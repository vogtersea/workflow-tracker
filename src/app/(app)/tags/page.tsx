'use client';

import { useState, useEffect } from 'react';
import { Empty, Loading, ConfirmDialog } from '@/components/ui';
import { useShell } from '@/components/Shell';

interface Tag {
  id: number;
  name: string;
  color: string;
  usage_count: number;
}

const PRESET_COLORS = [
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#1d4ed8',
  '#6d28d9',
  '#be185d'
];

export default function TagsPage() {
  const { toast } = useShell();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/tags');
      const json = await res.json();
      if (json.ok) setTags(json.data);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim()) {
      toast('请输入标签名称', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color })
      });
      const json = await res.json();
      if (json.ok) {
        setName('');
        toast('标签已创建', 'success');
        load();
      } else toast(json.error || '创建失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!deleteId) return;
    const res = await fetch(`/api/tags?id=${deleteId}`, { method: 'DELETE' });
    const json = await res.json();
    setDeleteId(null);
    if (json.ok) {
      toast('标签已删除', 'success');
      load();
    } else toast(json.error || '删除失败', 'error');
  }

  if (loading) return <Loading />;

  return (
    <div className="split split-side">
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">新建标签</div>
        </div>
        <div className="panel-body">
          <div className="field">
            <label className="field-label">标签名称</label>
            <input
              className="input"
              placeholder="如：日常事务、项目推进、材料撰写"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <div className="field-hint">建议按工作类别划分，便于报告归纳与分类统计</div>
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
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={create} disabled={saving}>
            {saving ? '创建中…' : '创建标签'}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">标签列表</div>
          <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
            共 {tags.length} 个
          </div>
        </div>
        {tags.length === 0 ? (
          <Empty title="暂无标签" desc="新建标签，用于工作分类与报告归纳" />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>标签</th>
                  <th style={{ width: 100 }}>使用次数</th>
                  <th style={{ width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="chip chip-tag">
                        <span className="dot" style={{ background: t.color }} />
                        {t.name}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>{t.usage_count} 项工作</td>
                    <td>
                      <button
                        className="btn btn-sm btn-ghost btn-danger"
                        onClick={() => setDeleteId(t.id)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteId && (
        <ConfirmDialog
          message="删除标签后，该标签与工作的关联会一并解除，但工作本身不受影响。确定删除？"
          onCancel={() => setDeleteId(null)}
          onConfirm={doDelete}
          confirmText="确认删除"
        />
      )}
    </div>
  );
}
