import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import { getFxCurrency, listFxBalances, fxFormat } from '@/lib/forex';
import { bookingRefs } from '@/lib/ledger';
import { fmtDate, fmtDateTime, todayIST } from '@/lib/dates';
import { inr } from '@/lib/money';
import { Card, Empty, Flash, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AutoRefresh } from '@/components/client';
import { FxForm } from '@/components/FxForm';
import { createFxAction, deleteFxAction, restoreFxAction } from '@/app/actions';

export const metadata = { title: 'Forex' };

export default async function FxCurrencyPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const { code: raw } = await params;
  const sp = await searchParams;
  const code = raw.toUpperCase();
  const [data, all, bookings] = await Promise.all([getFxCurrency(code), listFxBalances(true), bookingRefs()]);
  if (!data) notFound();
  const { currency: c, entries, deleted } = data;
  const idem = randomUUID();

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title={`${c.code} – ${c.name}`} subtitle={<Link href="/forex">← All currencies</Link>}
        actions={<a href="#add" className="btn btn-primary">+ Add {c.code} entry</a>} />
      {sp.saved && <Flash>Saved {sp.saved}. Holding updated.</Flash>}
      {sp.updated && <Flash>Entry updated. Holding recalculated.</Flash>}
      {sp.deleted && <Flash>Entry deleted. You can restore it at the bottom of this page.</Flash>}
      {sp.restored && <Flash>Entry restored.</Flash>}

      <div className="stats">
        <div className="stat stat-cash stat-emphasis"><span className="stat-label">Holding now</span><span className="stat-value">{fxFormat(c.balance, c.code)}</span>
          <span className="stat-hint">{c.inr_value !== null && Number(c.balance) > 0 ? `≈ ${inr(c.inr_value)} at ₹${Number(c.last_rate ?? c.avg_in_rate).toFixed(2)}` : 'Add a rate to see the rupee value'}</span></div>
        <div className="stat stat-in"><span className="stat-label">Total received / bought</span><span className="stat-value">{fxFormat(c.total_in, c.code)}</span>
          <span className="stat-hint">{c.avg_in_rate ? `Average rate ₹${Number(c.avg_in_rate).toFixed(2)}` : 'Since opening'}</span></div>
        <div className="stat stat-out"><span className="stat-label">Total given / spent</span><span className="stat-value">{fxFormat(c.total_out, c.code)}</span>
          <span className="stat-hint">Opening holding {fxFormat(c.opening_balance, c.code)}</span></div>
      </div>

      <Card title={`${c.code} entries`}>
        {entries.length === 0 ? <Empty title="No entries yet">Add the first one below.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Ref</th><th>Details</th><th className="num">In</th><th className="num">Out</th><th className="num">Rate ₹</th><th className="num">≈ ₹ value</th><th className="num">Holding after</th><th className="no-print"></th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{fmtDate(e.txn_date)}</td>
                    <td>{e.fx_no}{e.account === 'home' && <> <span className="badge b-home">Home</span></>}</td>
                    <td>{e.counterparty || '—'}<span className="sub">{[e.purpose, e.booking_ref, e.notes].filter(Boolean).join(' · ')}</span></td>
                    <td className="num pos">{e.direction === 'in' ? fxFormat(e.amount, c.code) : ''}</td>
                    <td className="num neg">{e.direction === 'out' ? fxFormat(e.amount, c.code) : ''}</td>
                    <td className="num">{e.rate_inr ? Number(e.rate_inr).toFixed(2) : '—'}</td>
                    <td className="num">{e.inr_value ? inr(e.inr_value) : '—'}</td>
                    <td className="num"><strong>{fxFormat(e.running_balance, c.code)}</strong></td>
                    <td className="no-print">
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <Link href={`/forex/entry/${e.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                        <ActionForm action={deleteFxAction} confirm={`Delete ${e.fx_no} (${fxFormat(e.amount, c.code)})? The holding will be recalculated. You can restore it later.`}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="currency" value={c.code} />
                          <SubmitButton className="btn btn-danger btn-sm" pendingText="…">Delete</SubmitButton>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Add ${c.code} entry`}>
        <div id="add" />
        <FxForm key={idem} action={createFxAction} mode="create" idem={idem} today={todayIST()} balance={c.balance}
                values={{ currency: c.code }} currencies={all.map((x) => ({ code: x.code, name: x.name }))}
                bookings={bookings.map((b) => ({ booking_ref: b.booking_ref, client_name: b.client_name }))} />
      </Card>

      {deleted.length > 0 && (
        <Card title="Deleted entries">
          <table><tbody>
            {deleted.map((e) => (
              <tr key={e.id}>
                <td>{e.fx_no}<span className="sub">{fmtDate(e.txn_date)} · {e.direction === 'in' ? 'In' : 'Out'} {fxFormat(e.amount, c.code)} · {e.counterparty ?? ''}</span></td>
                <td className="muted small">Deleted {fmtDateTime(e.deleted_at)}</td>
                <td>
                  <ActionForm action={restoreFxAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="currency" value={c.code} />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Restore</SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}
    </div>
  );
}
