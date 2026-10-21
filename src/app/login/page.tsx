'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { ensureBooted } from '@/lib/local-boot';

/**
 * 登录页
 *
 * 两种形态共用：
 *   服务端形态：库里的管理员由 ensureAdminSeed 自动创建，这里只做登录
 *   手机单机版：库里一开始没有任何账号，也不能像服务端那样把随机口令写进文件，
 *              所以首次打开时切换成「初始化」表单，由用户自己设定账号口令
 *
 * 判断依据是 /api/health 返回的用户数，两种形态都适用。
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [ready, setReady] = useState(false);
  const [needSetup, setNeedSetup] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureBooted();
        const res = await api('/api/health');
        const json = await res.json();
        if (!alive) return;
        const users = json?.data?.users ?? 0;
        setNeedSetup(users === 0);
        if (users === 0) setUsername('admin');
      } catch {
        /* health 失败也让用户看到登录表单，由登录本身报错 */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (needSetup && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      const endpoint = needSetup ? '/api/auth/setup' : '/api/auth/login';
      const body = needSetup
        ? { username, password, display_name: displayName || username }
        : { username, password };

      const res = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || (needSetup ? '初始化失败' : '登录失败'));
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

        {needSetup && (
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            首次使用，请先设置本机的管理员账号与密码。
          </div>
        )}

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

          {needSetup && (
            <div className="field">
              <label className="field-label">显示名称</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="留空则与用户名相同"
              />
            </div>
          )}

          <div className="field">
            <label className="field-label">密码</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={needSetup ? 'new-password' : 'current-password'}
              placeholder={needSetup ? '至少 6 位' : '请输入密码'}
            />
          </div>

          {needSetup && (
            <div className="field">
              <label className="field-label">确认密码</label>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="再输入一次"
              />
            </div>
          )}

          <button
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
            disabled={loading || !ready}
          >
            {loading ? <span className="spinner" /> : null}
            {loading ? (needSetup ? '创建中…' : '登录中…') : needSetup ? '创建并进入' : '登 录'}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11.5, color: 'var(--ink-400)', lineHeight: 1.8 }}>
          {needSetup ? (
            <>本机版的数据全部保存在这台设备上，不会上传到任何服务器。</>
          ) : (
            <>
              管理员账号 <code style={{ color: 'var(--ink-600)' }}>admin</code>，
              初始密码由系统随机生成，见数据目录下的
              <code style={{ color: 'var(--ink-600)' }}> 初始密码.txt</code>，登录后请立即修改。
            </>
          )}
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
