import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { isPasswordSet } from '@/lib/auth-core';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Logo } from '@/components/Shell';
import { loginAction } from '@/app/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect('/');
  if (!(await isPasswordSet())) redirect('/setup');
  const { next } = await searchParams;
  return (
    <div className="auth">
      <div className="auth-card">
        <Logo />
        <h1>Sign in</h1>
        <p className="muted small">Skyroad Holidays cash management</p>
        <ActionForm action={loginAction} className="form">
          <input type="hidden" name="next" value={next ?? '/'} />
          <label className="field">
            <span className="field-label">Username</span>
            <input name="username" defaultValue="Skyroadholidays" autoComplete="username" required autoCapitalize="none" />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input name="password" type="password" autoComplete="current-password" required autoFocus />
          </label>
          <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
