import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ensureDb } from './db';
import { validateSession, isPasswordSet, SESSION_MAX_DAYS, type SessionUser } from './auth-core';

export const SESSION_COOKIE = 'sr_session';

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Current user or null. Never throws for "not signed in". */
export async function currentUser(): Promise<SessionUser | null> {
  ensureDb();
  return validateSession(await readSessionToken());
}

/** Use at the top of every protected page, action and route. */
export async function requireUser(): Promise<SessionUser> {
  ensureDb();
  const user = await validateSession(await readSessionToken());
  if (!user) {
    if (!(await isPasswordSet())) redirect('/setup');
    redirect('/login');
  }
  return user;
}

export async function clientInfo() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  return { ip: ip.slice(0, 64), userAgent: (h.get('user-agent') ?? '').slice(0, 300) };
}
