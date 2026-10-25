import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { fmtDateTime } from '@/lib/dates';
import { inr } from '@/lib/money';
import { Card, Flash, Money, PageHeader, Icon } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AutoRefresh } from '@/components/client';
import { cashCountAction, saveLocationAction, toggleLocationAction } from '@/app/actions';
import { sumColumn } from '@/lib/csv';

export const metadata = { title: 'Cash & Locker' };

function DiffPill({ diff }: { diff: string }) {
  const n = Number(diff);
  if (n === 0) return <span className="diff-pill ok">Matches system</span>;
  return n < 0
    ? <span className="diff-pill short">Short by {inr(diff.replace('-', ''))}</span>
    : <span className="diff-pill excess">Excess of {inr(diff)}</span>;
}

export default async function CashPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const [locations, counts] = await Promise.all([L.listLocations(), L.listCashCounts(15)]);
  const active = locations.filter((l) => l.is_active);
  const inactive = locations.filter((l) => !l.is_active);
  const total = sumColumn(active, 'balance');

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title="Cash & Locker" subtitle={<>Total physical cash across locations: <strong><Money value={total} /></strong></>}
        actions={<Link href="/transactions/new?type=transfer" className="btn btn-primary">{Icon.transfer} Transfer cash</Link>} />

      {sp.welcome && (
        <Flash>
          Welcome! Your password is set. <strong>First step:</strong> enter the cash you have right now as the opening balance of each location below
          (Edit → Opening balance). Every later entry builds on it.
        </Flash>
      )}
      {sp.saved && <Flash>Location saved. Balances recalculated.</Flash>}
      {sp.counted !== undefined && (
        Number(sp.counted) === 0
          ? <Flash>Count recorded – it matches the system exactly.</Flash>
          : <Flash tone="warn">Count recorded: {Number(sp.counted) < 0 ? `short by ${inr(sp.counted.replace('-', ''))}` : `excess of ${inr(sp.counted)}`} compared to the system.</Flash>
      )}

      <div className="three-col">
        {active.map((l) => (
          <Card key={l.id} className="loc-card" title={<span className="row" style={{ gap: 8 }}>{l.kind === 'locker' ? Icon.locker : l.kind === 'hand' ? Icon.hand : Icon.wallet}{l.name}</span>}>
            <div className={`loc-bal ${Number(l.balance) < 0 ? 'neg' : ''}`}>{inr(l.balance)}</div>
            <div className="loc-lines">
              <span>Opening balance</span><span>{inr(l.opening_balance)}</span>
              <span>+ Cash received</span><span className="pos">{inr(l.received)}</span>
              <span>− Cash paid out</span><span className="neg">{inr(l.paid_out)}</span>
              <span>+ Transfers in</span><span>{inr(l.transfers_in)}</span>
              <span>− Transfers out</span><span>{inr(l.transfers_out)}</span>
              <span><strong>= Current balance</strong></span><span><strong>{inr(l.balance)}</strong></span>
            </div>
            <hr />
            <p className="section-label">Last physical count</p>
            {l.last_count_at ? (
              <p className="small" style={{ margin: 0 }}>{fmtDateTime(l.last_count_at)} · counted {inr(l.last_counted_amount)}<br /><DiffPill diff={l.last_count_diff!} /></p>
            ) : <p className="muted small" style={{ margin: 0 }}>Never counted.</p>}
            <div className="row" style={{ marginTop: 12 }}>
              <Link href={`/transactions/new?type=cash_in&location=${l.id}`} className="btn btn-primary btn-sm">+ Cash in</Link>
              <Link href={`/transactions/new?type=cash_out&location=${l.id}`} className="btn btn-ghost btn-sm">− Cash out</Link>
              <Link href={`/transactions?location=${l.id}`} className="btn btn-ghost btn-sm">Entries</Link>
              <Link href={`/reports?r=location&location=${l.id}&period=month`} className="btn btn-ghost btn-sm">Report</Link>
            </div>
          </Card>
        ))}
      </div>

      <div className="two-col">
        <Card title="Verify physical cash">
          <p className="muted small" style={{ marginTop: -6 }}>Count the notes, enter the total, and the system shows any shortage or excess against its balance.</p>
          <ActionForm action={cashCountAction} className="form">
            <div className="grid">
              <label className="field">
                <span className="field-label">Location</span>
                <select name="location_id" required>
                  {active.map((l) => <option key={l.id} value={l.id}>{l.name} (system {inr(l.balance)})</option>)}
                </select>
              </label>
              <label className="field field-amount">
                <span className="field-label">Amount counted (₹)</span>
                <input name="counted_amount" inputMode="decimal" required placeholder="0.00" autoComplete="off" />
              </label>
              <label className="field field-wide">
                <span className="field-label">Notes</span>
                <input name="notes" placeholder="e.g. counted at day close" maxLength={500} />
              </label>
              <label className="check field-wide">
                <input type="checkbox" name="post_adjustment" />
                <span>If there is a difference, <strong>post an adjustment entry</strong> so the system matches the counted cash.<br />
                  <span className="muted small">Leave unticked while you investigate – you can recount later.</span></span>
              </label>
            </div>
            <div className="form-actions"><SubmitButton>Record count</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card title="Recent counts">
          {counts.length === 0 ? <p className="muted small">No counts yet.</p> : (
            <table>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.location_name}<span className="sub">{fmtDateTime(c.counted_at)}{c.notes ? ` · ${c.notes}` : ''}</span></td>
                    <td className="num"><Money value={c.counted_amount} /><span className="sub">system {inr(c.system_balance)}</span></td>
                    <td><DiffPill diff={c.difference} />{c.adjustment_txn_id && <span className="sub"><Link href={`/transactions/${c.adjustment_txn_id}`}>adjusted</Link></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Manage locations">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th className="num">Opening balance</th><th className="num">Order</th><th></th><th></th></tr></thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}>
                  <td colSpan={4} style={{ padding: 0 }}>
                    <ActionForm action={saveLocationAction} className="row" id={`loc-${l.id}`}>
                      <input type="hidden" name="id" value={l.id} />
                      <input name="name" defaultValue={l.name} required maxLength={60} style={{ flex: '2 1 160px', width: 'auto' }} aria-label="Name" />
                      <select name="kind" defaultValue={l.kind} style={{ flex: '1 1 110px', width: 'auto' }} aria-label="Type">
                        <option value="hand">Cash in hand</option><option value="locker">Locker</option><option value="other">Other</option>
                      </select>
                      <input name="opening_balance" defaultValue={l.opening_balance} inputMode="decimal" style={{ flex: '1 1 120px', width: 'auto', textAlign: 'right' }} aria-label="Opening balance" />
                      <input name="sort_order" defaultValue={l.sort_order} inputMode="numeric" style={{ flex: '0 0 64px', width: 64 }} aria-label="Order" />
                      <SubmitButton className="btn btn-ghost btn-sm">Save</SubmitButton>
                    </ActionForm>
                  </td>
                  <td>{l.is_active ? <span className="status s-done">Active</span> : <span className="status s-pending">Inactive</span>}</td>
                  <td>
                    <ActionForm action={toggleLocationAction} confirm={l.is_active ? `Deactivate ${l.name}? Its balance must be ₹0.00.` : undefined}>
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="active" value={String(!l.is_active)} />
                      <SubmitButton className="btn btn-link small">{l.is_active ? 'Deactivate' : 'Reactivate'}</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Changing an opening balance shifts that location&apos;s balance by the same amount and is recorded in the audit log.{inactive.length ? ` ${inactive.length} inactive location(s) are hidden from entry forms.` : ''}</p>
        <hr />
        <p className="section-label">Add a cash location</p>
        <ActionForm action={saveLocationAction} className="row">
          <input name="name" placeholder="e.g. Branch safe, Petty cash" required maxLength={60} style={{ flex: '2 1 200px', width: 'auto' }} />
          <select name="kind" defaultValue="other" style={{ flex: '1 1 120px', width: 'auto' }}>
            <option value="other">Other</option><option value="hand">Cash in hand</option><option value="locker">Locker</option>
          </select>
          <input name="opening_balance" placeholder="Opening ₹0.00" inputMode="decimal" style={{ flex: '1 1 140px', width: 'auto' }} />
          <SubmitButton className="btn btn-primary">Add location</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
