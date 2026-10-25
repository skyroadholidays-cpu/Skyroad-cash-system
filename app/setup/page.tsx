import { redirect } from 'next/navigation';
import { ensureDb } from '@/lib/db';
import { isPasswordSet } from '@/lib/auth-core';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Logo } from '@/components/Shell';
import { setupAction } from '@/app/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'First-time setup' };

export default async function SetupPage() {
  ensureDb();
  if (await isPasswordSet()) redirect('/login');
  const enabled = !!process.env.SETUP_TOKEN && process.env.SETUP_TOKEN.length >= 12;
  return (
    <div className="auth">
      <div className="auth-card">
        <Logo />
        <h1>Set your password</h1>
        <p className="muted small">One-time setup for the <strong>Skyroadholidays</strong> account. You can change it later in Settings.</p>
        {!enabled ? (
          <div className="alert alert-warn" style={{ marginTop: 16 }}>
            Setup is locked. Add a <code>SETUP_TOKEN</code> environment variable (at least 12 characters) to your hosting settings, redeploy, then reload this page.
          </div>
        ) : (
          <ActionForm action={setupAction} className="form">
            <label className="field">
              <span className="field-label">Setup code</span>
              <input name="setup_token" type="password" required autoComplete="off" />
              <span className="field-hint">The SETUP_TOKEN value from your hosting settings. Stops strangers claiming the account.</span>
            </label>
            <label className="field">
              <span className="field-label">New password</span>
              <input name="password" type="password" minLength={8} required autoComplete="new-password" />
              <span className="field-hint">At least 8 characters. A short sentence is easy to remember and hard to guess.</span>
            </label>
            <label className="field">
              <span className="field-label">Confirm password</span>
              <input name="confirm" type="password" minLength={8} required autoComplete="new-password" />
            </label>
            <SubmitButton pendingText="Saving…">Save password & sign in</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
