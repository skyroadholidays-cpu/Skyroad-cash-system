import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listSessions } from '@/lib/auth-core';
import * as L from '@/lib/ledger';
import { db } from '@/lib/db-core';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { Card, Money, PageHeader, TypeBadge } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { changePasswordAction, signOutOthersAction, restoreTxnAction } from '@/app/actions';

export const metadata = { title: 'Settings' };

function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const [sessions, deleted, audit] = await Promise.all([
    listSessions(user),
    L.listDeletedTxns(50),
    db()<{ at: string; actor: string | null; table_name: string; action: string; record_id: string; label: string | null }>`
      select a.at::text, a.actor, a.table_name, a.action, a.record_id,
             coalesce(a.new_data->>'txn_no', a.old_data->>'txn_no', a.new_data->>'booking_ref', a.old_data->>'booking_ref', a.new_data->>'name', a.old_data->>'name') as label
      from skyroad.audit_log a order by a.at desc, a.id desc limit 40`,
  ]);

  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle={`Signed in as ${user.username}`} />

      <div className="two-col">
        <Card title="Change password">
          <ActionForm action={changePasswordAction} className="form">
            <div className="grid">
              <label className="field field-wide"><span className="field-label">Current password</span><input type="password" name="current" required autoComplete="current-password" /></label>
              <label className="field"><span className="field-label">New password</span><input type="password" name="password" required minLength={8} autoComplete="new-password" /></label>
              <label className="field"><span className="field-label">Confirm new password</span><input type="password" name="confirm" required minLength={8} autoComplete="new-password" /></label>
            </div>
            <p className="muted small">Changing your password signs out every other device.</p>
            <div className="form-actions"><SubmitButton>Change password</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card title="Signed-in devices">
          <table><tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{device(s.user_agent)}{s.current && <span className="badge b-in" style={{ marginLeft: 6 }}>This device</span>}<span className="sub">Last active {fmtDateTime(s.last_seen_at)}</span></td>
              </tr>
            ))}
          </tbody></table>
          <ActionForm action={signOutOthersAction} confirm="Sign out all other devices?">
            <div className="form-actions"><SubmitButton className="btn btn-ghost">Sign out all other devices</SubmitButton></div>
          </ActionForm>
          <p className="muted small">Sessions end after 7 days without use, and always after 30 days.</p>
        </Card>
      </div>

      <Card title="Backup & export">
        <p style={{ marginTop: 0 }}>Download a complete copy of every record – cash locations, bookings, all transactions (including deleted ones), cash counts and the full change history.</p>
        <div className="row">
          <a href="/api/backup" className="btn btn-primary">Download full backup (JSON)</a>
          <a href="/api/export?r=register&from=2000-01-01&to=2999-12-31" className="btn btn-ghost">All transactions (CSV)</a>
          <a href="/api/export?r=booking&from=2000-01-01&to=2999-12-31" className="btn btn-ghost">All bookings (CSV)</a>
        </div>
        <p className="muted small">Recommended: download a backup every Friday and keep it in Google Drive or iCloud. Your database host also keeps its own backups – see the README.</p>
      </Card>

      <Card title="Trash – deleted entries" actions={<span className="muted small">Restoring recalculates every balance</span>}>
        {deleted.length === 0 ? <p className="muted small">Nothing deleted.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Txn</th><th>Details</th><th className="num">Amount</th><th>Deleted</th><th></th></tr></thead>
            <tbody>
              {deleted.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/transactions/${t.id}`}>{t.txn_no}</Link><span className="sub"><TypeBadge type={t.type} /></span></td>
                  <td>{t.client_name || t.supplier_name || '—'}<span className="sub">{fmtDate(t.txn_date)}{t.booking_ref ? ` · ${t.booking_ref}` : ''}{t.description ? ` · ${t.description}` : ''}</span></td>
                  <td className="num"><Money value={t.amount} /></td>
                  <td>{fmtDateTime(t.deleted_at)}</td>
                  <td>
                    <ActionForm action={restoreTxnAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Restore</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card title="Audit trail – latest changes">
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th></tr></thead>
          <tbody>
            {audit.map((a, i) => (
              <tr key={i}>
                <td>{fmtDateTime(a.at)}</td>
                <td>{a.actor ?? 'system'}</td>
                <td>{{ insert: 'Created', update: 'Edited', delete: 'Removed', soft_delete: 'Deleted', restore: 'Restored' }[a.action] ?? a.action} {{ txn: 'transaction', booking: 'booking', cash_location: 'cash location', cash_count: 'cash count' }[a.table_name] ?? a.table_name}</td>
                <td>{a.table_name === 'txn' ? <Link href={`/transactions/${a.record_id}`}>{a.label ?? a.record_id.slice(0, 8)}</Link>
                  : a.table_name === 'booking' ? <Link href={`/bookings/${a.record_id}`}>{a.label ?? a.record_id}</Link> : (a.label ?? a.record_id)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
