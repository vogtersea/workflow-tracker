'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || '登录失败');
        setLoading(false);
        return;
      }
      const next = params.get('next') || '/';
      router.replace(next);
      router.refresh();
    } catch {
      setError('网络异常，请稍后重试');
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-title">工作流程跟踪工作台</div>
        <div className="login-sub">Workflow Tracker</div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label className="field-label">用户名</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              placeholder="请输入用户名"
            />
          </div>
          <div className="field">
            <label className="field-label">密码</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
            />
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            {loading ? '登录中…' : '登 录'}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11.5, color: 'var(--ink-400)', lineHeight: 1.8 }}>
          管理员账号 <code style={{ color: 'var(--ink-600)' }}>admin</code>，
          初始密码由系统随机生成，见数据目录下的
          <code style={{ color: 'var(--ink-600)' }}> 初始密码.txt</code>，登录后请立即修改。
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-page"><div className="login-card">加载中…</div></div>}>
      <LoginForm />
    </Suspense>
  );
}
