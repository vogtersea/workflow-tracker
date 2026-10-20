import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession, COOKIE_KEY } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const jar = await cookies();
  const token = jar.get(COOKIE_KEY)?.value;
  if (token) destroySession(token);

  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: COOKIE_KEY, value: '', path: '/', maxAge: 0 });
  return res;
}
