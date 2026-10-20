'use client';

import { useEffect, useRef } from 'react';

/** 通用弹窗 */
export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  maxWidth
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
  maxWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        style={maxWidth ? { maxWidth } : undefined}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** 确认框 */
export function ConfirmDialog({
  title = '确认操作',
  message,
  onCancel,
  onConfirm,
  danger = true,
  confirmText = '确认'
}: {
  title?: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
  confirmText?: string;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      maxWidth={400}
      footer={
        <>
          <button className="btn btn-sm" onClick={onCancel}>
            取消
          </button>
          <button
            className={`btn btn-sm ${danger ? 'btn-primary' : 'btn-gold'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: 'var(--ink-600)' }}>{message}</p>
    </Modal>
  );
}

/** 空状态 */
export function Empty({
  title = '暂无数据',
  desc,
  action
}: {
  title?: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action}
    </div>
  );
}

/** 加载态 */
export function Loading({ text = '加载中' }: { text?: string }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>
      <span className="spinner dark" style={{ marginRight: 8, verticalAlign: -2 }} />
      {text}…
    </div>
  );
}

/** 状态标签 */
export function StatusChip({ status }: { status: string }) {
  if (status === 'done') return <span className="chip chip-ok">已完成</span>;
  if (status === 'archived') return <span className="chip chip-muted">已归档</span>;
  return <span className="chip chip-red">进行中</span>;
}

/** 优先级标签 */
export function PriorityChip({ priority }: { priority: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    urgent: { label: '紧急', cls: 'chip-danger' },
    high: { label: '重要', cls: 'chip-warn' },
    normal: { label: '普通', cls: 'chip-muted' },
    low: { label: '低', cls: 'chip-muted' }
  };
  const m = map[priority] || map.normal;
  return <span className={`chip ${m.cls}`}>{m.label}</span>;
}

/** DDL 标签 */
export function DueChip({ dueDate, status }: { dueDate: string | null; status: string }) {
  if (!dueDate) return <span className="chip chip-muted">无 DDL</span>;

  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const [y, m, d] = dueDate.split('-').map(Number);
  const due = new Date(y, m - 1, d).getTime();
  const days = Math.round((due - t) / 86400000);

  if (status !== 'open') {
    return <span className="chip chip-muted">{dueDate}</span>;
  }
  if (days < 0) return <span className="chip chip-danger">逾期 {-days} 天</span>;
  if (days === 0) return <span className="chip chip-danger">今天到期</span>;
  if (days === 1) return <span className="chip chip-warn">明天到期</span>;
  if (days <= 3) return <span className="chip chip-warn">{days} 天后</span>;
  return <span className="chip chip-muted">{days} 天后</span>;
}

/** 标签色点 */
export function TagPills({ tags }: { tags: { id: number; name: string; color: string }[] }) {
  if (!tags?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <span key={t.id} className="chip chip-tag">
          <span className="dot" style={{ background: t.color }} />
          {t.name}
        </span>
      ))}
    </span>
  );
}
