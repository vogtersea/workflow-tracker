'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import type { SessionUser } from '@/lib/auth';
import { apiJson } from '@/lib/api-client';
import { ensureBooted } from '@/lib/local-boot';

/**
 * 应用外壳
 *
 * 原来是服务端组件，靠 cookies() 直接读会话。手机单机版没有服务端，
 * 所以改成客户端：先等本地库就绪，再问一次 /api/auth/me 拿当前用户。
 *
 * 服务端形态下这一步多了一次接口往返，但换来的是两种形态共用同一份代码，
 * 不会出现「手机版改了、桌面版忘了改」的漂移。
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureBooted();
        const r = await apiJson<SessionUser>('/api/auth/me');
        if (!alive) return;
        if (r.ok && r.data) setUser(r.data);
        else router.replace('/login');
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '启动失败');
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: 'var(--font-sans)', color: 'var(--ink-700)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>启动失败</div>
        <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 16, lineHeight: 1.7 }}>
          {error}
        </div>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          重试
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-sans)',
          color: 'var(--ink-400)',
          fontSize: 13,
          letterSpacing: 1
        }}
      >
        正在加载…
      </div>
    );
  }

  return <Shell user={user}>{children}</Shell>;
}
