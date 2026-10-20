import { redirect } from 'next/navigation';
import { getCurrentUser, ensureAdminSeed } from '@/lib/auth';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 首次启动自建管理员
  ensureAdminSeed();

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <Shell user={user}>{children}</Shell>;
}
