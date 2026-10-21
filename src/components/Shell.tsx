'use client';

import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CurrentUser } from '@/types';

interface ShellContextValue {
  user: CurrentUser | null;
  refreshBadges: () => void;
  toast: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

export const ShellContext = createContext<ShellContextValue>({
  user: null,
  refreshBadges: () => {},
  toast: () => {}
});

export const useShell = () => useContext(ShellContext);

interface BadgeData {
  unseen: number;
  overdue: number;
  dueSoon: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  key: string;
  badge?: string;
  adminOnly?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  { group: '工作', items: [
    { href: '/', label: '工作台', icon: '◱', key: 'home' },
    { href: '/tasks', label: '工作管理', icon: '☰', key: 'tasks', badge: 'open' },
    { href: '/week', label: '周视图', icon: '▤', key: 'week' },
    { href: '/calendar', label: '日历视图', icon: '▦', key: 'calendar' }
  ]},
  { group: '报告', items: [
    { href: '/reports', label: '总结报告', icon: '✎', key: 'reports' },
    { href: '/reports/new', label: '生成报告', icon: '✦', key: 'gen' }
  ]},
  { group: '管理', items: [
    { href: '/templates', label: '例行工作', icon: '↻', key: 'templates' },
    { href: '/projects', label: '项目分组', icon: '◫', key: 'projects' },
    { href: '/tags', label: '标签管理', icon: '◈', key: 'tags' },
    { href: '/notifications', label: '待办提醒', icon: '⚑', key: 'noti', badge: 'unseen' }
  ]},
  { group: '设置', items: [
    { href: '/settings', label: '系统设置', icon: '⚙', key: 'settings' },
    { href: '/settings/users', label: '用户管理', icon: '♟', key: 'users', adminOnly: true },
    { href: '/obsidian', label: 'Obsidian', icon: '◫', key: 'obsidian' }
  ]}
];

export default function Shell({
  user,
  children
}: {
  user: CurrentUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [badges, setBadges] = useState<BadgeData>({ unseen: 0, overdue: 0, dueSoon: 0 });
  const [toastMsg, setToastMsg] = useState<{ text: string; type: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifyAsked, setNotifyAsked] = useState(false);

  const toast = useCallback((text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const refreshBadges = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/badges');
      const json = await res.json();
      if (json.ok) setBadges(json.data);
    } catch {
      /* 静默失败 */
    }
  }, []);

  useEffect(() => {
    refreshBadges();
    const timer = setInterval(refreshBadges, 60_000);

    // 浏览器桌面通知：仅在有逾期项时提醒一次
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const asked = localStorage.getItem('wt:notify-asked');
      if (!asked) setNotifyAsked(true);
    }

    return () => clearInterval(timer);
  }, [refreshBadges]);

  // 桌面通知兜底：有逾期且已授权时提示
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!badges.overdue) return;

    const key = 'wt:notified-date';
    const todayStr = new Date().toDateString();
    if (localStorage.getItem(key) === todayStr) return;

    new Notification('工作流程提醒', {
      body: `当前有 ${badges.overdue} 项工作已逾期，请及时处理`,
      icon: '/favicon.ico',
      tag: 'wt-overdue'
    });
    localStorage.setItem(key, todayStr);
  }, [badges.overdue]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // 抽屉打开时锁定页面滚动，避免背景跟着滑动
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  async function enableNotify() {
    if (!('Notification' in window)) {
      toast('当前浏览器不支持桌面通知', 'error');
      return;
    }
    const perm = await Notification.requestPermission();
    localStorage.setItem('wt:notify-asked', '1');
    setNotifyAsked(false);
    if (perm === 'granted') toast('桌面通知已开启', 'success');
    else toast('桌面通知未授权，可在浏览器设置中开启', 'error');
  }

  const pageTitle =
    NAV.flatMap((g) => g.items).find((i) => i.href === pathname)?.label || '工作流程跟踪';

  return (
    <ShellContext.Provider value={{ user, refreshBadges, toast }}>
      <div className="app-shell">
        {mobileOpen && (
          <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
        )}
        <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
          <div className="sidebar-brand">
            <div className="sidebar-brand-title">工作流程跟踪</div>
            <div className="sidebar-brand-sub">Workflow Tracker</div>
            <button
              className="sidebar-close"
              onClick={() => setMobileOpen(false)}
              aria-label="关闭菜单"
            >
              ×
            </button>
          </div>

          <nav className="sidebar-nav">
            {NAV.map((group) => {
              const items = group.items.filter((i) => !i.adminOnly || user.role === 'admin');
              if (!items.length) return null;
              return (
                <div key={group.group}>
                  <div className="nav-group-label">{group.group}</div>
                  {items.map((item) => {
                    const active =
                      item.href === '/'
                        ? pathname === '/'
                        : pathname === item.href || pathname.startsWith(item.href + '/');
                    const badgeVal =
                      item.key === 'noti'
                        ? badges.unseen
                        : item.key === 'tasks'
                          ? badges.overdue
                          : 0;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`nav-item ${active ? 'active' : ''}`}
                      >
                        <span style={{ width: 14, textAlign: 'center', opacity: 0.8 }}>
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                        {badgeVal > 0 && (
                          <span className={`nav-badge ${item.key === 'tasks' ? 'danger' : ''}`}>
                            {badgeVal > 99 ? '99+' : badgeVal}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="user-chip">
              <div className="user-avatar">{user.display_name.slice(0, 1)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="user-name">{user.display_name}</div>
                <div className="user-role">{user.role === 'admin' ? '管理员' : '成员'}</div>
              </div>
              <button
                onClick={logout}
                title="退出登录"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,235,200,0.5)',
                  fontSize: 13,
                  padding: 4
                }}
              >
                ⏻
              </button>
            </div>
          </div>
        </aside>

        <div className="main-area">
          <header className="topbar">
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="打开菜单"
            >
              ☰
            </button>
            <div className="page-title">{pageTitle}</div>
            <div className="topbar-actions">
              {badges.overdue > 0 && (
                <Link href="/tasks?filter=overdue" className="chip chip-danger">
                  <span className="dot" style={{ background: 'var(--danger)' }} />
                  逾期 {badges.overdue}
                </Link>
              )}
              {badges.dueSoon > 0 && (
                <Link href="/tasks?filter=due_soon" className="chip chip-warn">
                  临近 {badges.dueSoon}
                </Link>
              )}
              <Link href="/notifications" style={{ position: 'relative', padding: '4px 6px' }}>
                <span style={{ fontSize: 16, color: 'var(--ink-500)' }}>⚑</span>
                {badges.unseen > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      background: 'var(--red-700)',
                      color: '#fff',
                      fontSize: 9,
                      fontWeight: 700,
                      borderRadius: 8,
                      padding: '0 4px',
                      minWidth: 14,
                      textAlign: 'center',
                      lineHeight: '14px'
                    }}
                  >
                    {badges.unseen > 99 ? '99+' : badges.unseen}
                  </span>
                )}
              </Link>
            </div>
          </header>

          <main className="content">{children}</main>
        </div>
      </div>

      {notifyAsked && (
        <div className="modal-backdrop" onClick={() => setNotifyAsked(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">开启桌面提醒</div>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: 'var(--ink-600)' }}>
                开启后，当有工作临近 DDL 或已逾期时，浏览器会推送桌面通知，无需一直盯着页面。
                系统仍会在待办提醒中心保留完整记录。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => {
                localStorage.setItem('wt:notify-asked', '1');
                setNotifyAsked(false);
              }}>
                暂不开启
              </button>
              <button className="btn btn-primary btn-sm" onClick={enableNotify}>
                开启通知
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div className={`toast ${toastMsg.type === 'error' ? 'error' : toastMsg.type === 'success' ? 'success' : ''}`}>
          {toastMsg.text}
        </div>
      )}
    </ShellContext.Provider>
  );
}
